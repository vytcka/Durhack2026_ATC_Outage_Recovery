import { useEffect, useRef, useState } from 'react';

// One worker for the whole registry. Coalesce clock updates instead of building a backlog.
export function useAgentSimulation(flights, elapsed, options) {
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(null);
  const controllerRef = useRef(null);
  const target = Math.floor(elapsed / 10_000) * 10_000;
  const latestTarget = useRef(target);
  latestTarget.current = target;

  useEffect(() => {
    const worker = new Worker(new URL('./simulation.worker.js', import.meta.url), { type: 'module' });
    const controller = { target: latestTarget.current, time: null, inFlight: true, failed: false };
    controller.request = (time) => {
      controller.target = time;
      if (controller.failed || controller.inFlight || controller.time === time) return;
      controller.inFlight = true;
      setBusy(true);
      worker.postMessage({ type: 'advance', elapsed: time });
    };
    controllerRef.current = controller;
    setSnapshot(null);
    setError(null);
    setBusy(true);
    let active = true;
    const fail = (message) => {
      if (!active) return;
      controller.failed = true;
      setError(new Error(message));
      setBusy(false);
    };
    worker.onerror = (event) => fail(event.message || 'Simulation worker failed');
    worker.onmessage = ({ data }) => {
      if (!active) return;
      if (data.type === 'error') {
        fail(data.message);
        return;
      }
      controller.inFlight = false;
      controller.time = data.snapshot.time;
      // Do not flash a future state after the user has sought backwards.
      if (data.snapshot.time <= controller.target) setSnapshot(data.snapshot);
      if (controller.time !== controller.target) controller.request(controller.target);
      else setBusy(false);
    };
    // Keep projection and presentation data out of the agent engine.
    worker.postMessage({
      type: 'init', options,
      flights: flights.map(({ aircraft_reg, flight_number, airport_dep, airport_dest, est_flight_dur, from, to }) => ({
        aircraft_reg, flight_number, airport_dep, airport_dest, est_flight_dur,
        origin: [from.lon, from.lat], destination: [to.lon, to.lat],
      })),
    });
    return () => {
      active = false;
      worker.terminate();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [flights, options]);

  useEffect(() => {
    controllerRef.current?.request(target);
  }, [target, flights, options]);

  return { snapshot, busy, error };
}
