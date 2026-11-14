import { useEffect, useState } from 'react';
import { prepareFlights } from './flights.js';

// Loads aircraft records. Today this is a static JSON file in /public; later the URL can point
// at the live feed as long as it returns the same shape.
export function useAircraft(url = '/aircraft_info.json') {
  const [flights, setFlights] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
        return response.json();
      })
      .then((records) => {
        setFlights(prepareFlights(records));
        setError(null);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err);
      });

    return () => controller.abort();
  }, [url]);

  return { flights, error };
}
