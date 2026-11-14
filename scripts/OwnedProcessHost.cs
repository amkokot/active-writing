// Windows-only, dependency-free lifetime boundary for one Aw child tree.
// The job handle is never inherited. Closing/crashing this host kills only
// processes assigned to its private job, including OpenSSH ProxyJump children.
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.IO;
using System.Text.RegularExpressions;

public static class OwnedProcessHost {
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_BASIC_INFORMATION { public IntPtr Reserved, Peb, Reserved2, Reserved3, Id, ParentId; }
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process, int kind, ref PROCESS_BASIC_INFORMATION info, int size, out int returned);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMITS {
    public long ProcessTime, JobTime; public uint Flags; public UIntPtr Minimum, Maximum;
    public uint Active; public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMITS {
    public BASIC_LIMITS Basic; public IO_COUNTERS IO; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO {
    public int Size; public string Reserved, Desktop, Title;
    public uint X,Y,Width,Height,CharsX,CharsY,Fill,Flags; public ushort Show,ReservedSize;
    public IntPtr ReservedBytes, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr Process, Thread; public uint Id, ThreadId; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref EXTENDED_LIMITS info, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory, ref STARTUPINFO startup, out PROCESS_INFORMATION process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint id);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool all, uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  static string Quote(string value) {
    StringBuilder result=new StringBuilder("\""); int slashes=0;
    foreach(char c in value) {
      if(c=='\\') { slashes++; continue; }
      if(c=='"') result.Append('\\',slashes*2+1).Append(c);
      else result.Append('\\',slashes).Append(c);
      slashes=0;
    }
    return result.Append('\\',slashes*2).Append('"').ToString();
  }
  // Follow only this helper's ancestors; never attach to an unrelated SSH.
  static IntPtr SshOwner(string executable) {
    IntPtr current=new IntPtr(-1); bool owned=false;
    try {
      for(int depth=0;depth<8;depth++) {
        long childBorn,exit,kernel,user;
        if(!GetProcessTimes(current,out childBorn,out exit,out kernel,out user)) break;
        PROCESS_BASIC_INFORMATION info=new PROCESS_BASIC_INFORMATION(); int returned;
        if(NtQueryInformationProcess(current,0,ref info,Marshal.SizeOf(typeof(PROCESS_BASIC_INFORMATION)),out returned)!=0) break;
        uint pid=unchecked((uint)info.ParentId.ToInt64()); if(pid==0) break;
        IntPtr ancestor=OpenProcess(0x00100400,false,pid);
        if(ancestor==IntPtr.Zero) break;
        if(owned) CloseHandle(current); current=ancestor; owned=true;
        long born;
        if(!GetProcessTimes(current,out born,out exit,out kernel,out user) || born>childBorn) break;
        StringBuilder name=new StringBuilder(32768); uint size=(uint)name.Capacity;
        if(QueryFullProcessImageName(current,0,name,ref size) && String.Equals(name.ToString(),executable,StringComparison.OrdinalIgnoreCase)) {
          owned=false; return current;
        }
      }
      throw new InvalidOperationException("No live OpenSSH ancestor owns this proxy");
    } finally { if(owned) CloseHandle(current); }
  }
  public static int Main(string[] args) {
    IntPtr parent=IntPtr.Zero, job=IntPtr.Zero; PROCESS_INFORMATION child=new PROCESS_INFORMATION(); bool assigned=false;
    try {
      if(args.Length>0 && args[0]=="--ssh-proxy") {
        int port;
        if(args.Length!=4 || !Regex.IsMatch(args[1],@"\A[A-Za-z0-9][A-Za-z0-9.-]*\z") || !Int32.TryParse(args[2],out port) || port<1 || port>65535 || !Regex.IsMatch(args[3],@"\A[A-Za-z][A-Za-z0-9_-]*\z")) throw new ArgumentException("Expected proxy hostname, port and configured jump alias.");
        string ssh=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"OpenSSH","ssh.exe");
        parent=SshOwner(ssh);
        args=new string[]{"proxy-owner",ssh,"-W","["+args[1]+"]:"+port,args[3]};
      } else {
        uint parentId;
        if(args.Length<2 || !UInt32.TryParse(args[0],out parentId) || parentId==0) throw new ArgumentException("Expected owner PID and executable.");
        parent=OpenProcess(0x00100000,false,parentId);
      }
      if(parent==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(),"Aw process owner is unavailable");
      job=CreateJobObject(IntPtr.Zero,null);
      EXTENDED_LIMITS limits=new EXTENDED_LIMITS(); limits.Basic.Flags=0x00002000; // KILL_ON_JOB_CLOSE
      if(job==IntPtr.Zero || !SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMITS)))) throw new Win32Exception(Marshal.GetLastWin32Error(),"Cannot contain Aw child processes");
      StringBuilder command=new StringBuilder();
      for(int i=1;i<args.Length;i++) { if(i>1) command.Append(' '); command.Append(Quote(args[i])); }
      STARTUPINFO startup=new STARTUPINFO(); startup.Size=Marshal.SizeOf(typeof(STARTUPINFO)); startup.Flags=0x00000100;
      startup.Input=GetStdHandle(-10); startup.Output=GetStdHandle(-11); startup.Error=GetStdHandle(-12);
      // Suspend before assignment: even an immediately spawning child cannot escape.
      if(!CreateProcess(args[1],command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,null,ref startup,out child)) throw new Win32Exception(Marshal.GetLastWin32Error(),"Cannot start Aw child");
      if(!AssignProcessToJobObject(job,child.Process)) throw new Win32Exception(Marshal.GetLastWin32Error(),"Cannot assign Aw child job");
      assigned=true;
      if(ResumeThread(child.Thread)==UInt32.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error(),"Cannot resume Aw child");
      uint completed=WaitForMultipleObjects(2,new IntPtr[]{child.Process,parent},false,UInt32.MaxValue);
      if(completed==0) { uint code; if(!GetExitCodeProcess(child.Process,out code)) return 125; return unchecked((int)code); }
      return 125;
    } catch(Exception error) { Console.Error.WriteLine("Aw process containment: "+error.Message); return 125; }
    finally {
      if(!assigned && child.Process!=IntPtr.Zero) TerminateProcess(child.Process,125);
      if(job!=IntPtr.Zero) CloseHandle(job);
      if(child.Thread!=IntPtr.Zero) CloseHandle(child.Thread);
      if(child.Process!=IntPtr.Zero) CloseHandle(child.Process);
      if(parent!=IntPtr.Zero) CloseHandle(parent);
    }
  }
}
