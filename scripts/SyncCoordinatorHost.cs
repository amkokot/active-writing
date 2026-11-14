// Ephemeral scheduling lease only. The kernel releases this mutex on process exit.
using System;
using System.Diagnostics;
using System.Threading;

static class SyncCoordinatorHost {
  static int Main(string[] args) {
    try {
      int owner, wait;
      if(args.Length != 3 || !Int32.TryParse(args[0], out owner) || owner <= 0 ||
         !Int32.TryParse(args[2], out wait) || wait < 0 || wait > 2000 ||
         !System.Text.RegularExpressions.Regex.IsMatch(args[1], "^[a-f0-9]{64}$")) return 125;
      var parent = Process.GetProcessById(owner);
      using(var mutex = new Mutex(false, "Local\\AwSyncSchedule-" + args[1])) {
        bool acquired;
        try { acquired = mutex.WaitOne(wait); } catch(AbandonedMutexException) { acquired = true; }
        if(!acquired) return 73;
        try {
          // No timer, network or child jobs. Also release if an owner dies with an open pipe.
          var monitor = new Thread(() => { try { parent.WaitForExit(); } finally { Environment.Exit(0); } });
          monitor.IsBackground = true; monitor.Start();
          Console.WriteLine("AW_SCHEDULE_HELD"); Console.Out.Flush();
          Console.ReadLine();
        } finally { mutex.ReleaseMutex(); parent.Dispose(); }
      }
      return 0;
    } catch { return 125; }
  }
}
