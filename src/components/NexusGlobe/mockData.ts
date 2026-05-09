// Demo node/connection data for the Nexus Globe
// Replace with real P2P data from socket/API when networking layer is built.

export interface LumiNode {
  id: string;
  lat: number;
  lng: number;
  altitude: number;
  label: string;
  active: boolean;
}

export interface LumiConnection {
  from: string;
  to: string;
  bandwidth: number;
}

const CITY_DATA: [string, number, number][] = [
  ['SF', 37.77, -122.42],
  ['NYC', 40.71, -74.01],
  ['London', 51.51, -0.13],
  ['Tokyo', 35.69, 139.69],
  ['Shanghai', 31.23, 121.47],
  ['Singapore', 1.35, 103.82],
  ['Sydney', -33.87, 151.21],
  ['Berlin', 52.52, 13.40],
  ['Moscow', 55.75, 37.62],
  ['Dubai', 25.20, 55.27],
  ['Mumbai', 19.08, 72.88],
  ['Seoul', 37.57, 126.98],
  ['Paris', 48.86, 2.35],
  ['Toronto', 43.65, -79.38],
  ['SaoPaulo', -23.55, -46.63],
  ['Lagos', 6.45, 3.40],
  ['Cairo', 30.04, 31.24],
  ['Bangkok', 13.75, 100.50],
  ['Jakarta', -6.21, 106.85],
  ['Melbourne', -37.81, 144.96],
  ['CapeTown', -33.92, 18.42],
  ['Lima', -12.05, -77.04],
  ['MexicoCity', 19.43, -99.13],
  ['Istanbul', 41.01, 28.98],
];

// Great-circle distance in radians
function angularDist(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180;
  const a1 = lat1 * toRad, b1 = lng1 * toRad;
  const a2 = lat2 * toRad, b2 = lng2 * toRad;
  const dLon = b2 - b1;
  return Math.acos(Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(dLon));
}

export function generateDemoNodes(): LumiNode[] {
  return CITY_DATA.map(([name, lat, lng], i) => ({
    id: `node_${name}`,
    lat,
    lng,
    altitude: 0.02 + Math.random() * 0.15,
    label: `NODE_${name.toUpperCase()}`,
    active: Math.random() > 0.2,
  }));
}

export function generateDemoConnections(nodes: LumiNode[]): LumiConnection[] {
  const connections: LumiConnection[] = [];
  const used = new Set<string>();

  for (const a of nodes) {
    const neighbors = nodes
      .filter(b => b.id !== a.id)
      .map(b => ({ node: b, dist: angularDist(a.lat, a.lng, b.lat, b.lng) }))
      .sort((x, y) => x.dist - y.dist)
      .slice(0, 2 + Math.floor(Math.random() * 2)); // 2-3 nearest neighbors

    for (const { node: b } of neighbors) {
      const key = [a.id, b.id].sort().join('|');
      if (used.has(key)) continue;
      used.add(key);
      connections.push({
        from: a.id,
        to: b.id,
        bandwidth: 0.3 + Math.random() * 0.7,
      });
    }
  }

  return connections;
}
