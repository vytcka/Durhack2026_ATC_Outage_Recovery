import { Simulation } from './engine.js';

let simulation = null;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') simulation = new Simulation(data.flights, data.options);
    else if (data.type !== 'advance') throw new Error(`Unknown worker request: ${data.type}`);
    if (!simulation) throw new Error('Simulation is not initialised');
    const snapshot = data.type === 'init' ? simulation.snapshot() : simulation.advanceTo(data.elapsed);
    self.postMessage({ type: 'snapshot', snapshot });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
