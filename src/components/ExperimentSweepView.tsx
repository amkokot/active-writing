import { useMemo, useState } from "react";
import { sweepDomain, type ExperimentSweep } from "../experimentSweep";
import { ExperimentPlotView } from "./ExperimentPlotView";

export function ExperimentSweepView({ sweep }: { sweep: ExperimentSweep }) {
  const [value, setValue] = useState<number>();
  const match = value === undefined ? -1 : sweep.frames.findIndex(frame => frame.value === value);
  const index = match < 0 ? sweep.initial ?? 0 : match;
  const domain = useMemo(() => sweepDomain(sweep), [sweep]);
  const frame = sweep.frames[index];
  return <div className="experiment-sweep">
    <label>{sweep.parameter} = <output aria-label={`${sweep.parameter} = ${frame.value}`}>{String(frame.value)}</output><input aria-label={`${sweep.parameter} saved parameter`} aria-valuetext={`${sweep.parameter} = ${frame.value}; sample ${index + 1} of ${sweep.frames.length}`} type="range" min={0} max={sweep.frames.length - 1} step={1} value={index} onChange={event => setValue(sweep.frames[Number(event.target.value)].value)} /></label>
    <small>{index + 1} / {sweep.frames.length} saved samples · fixed axes · no rerun</small>
    <ExperimentPlotView key={index} plot={{ ...frame.plot, title: `${sweep.title} · ${sweep.parameter} = ${frame.value}` }} domain={domain} />
  </div>;
}
