// Geographic arrays in this fixture are an adapted OpenStreetMap database,
// © OpenStreetMap contributors, available under ODbL 1.0:
// https://opendatacommons.org/licenses/odbl/1-0/
// Curated connected Honmura town core. Junctions retain original OSM node IDs;
// corridor polylines retain mapped curves. No generated shortcuts are added.
// No third-party request is made at runtime.
export const HONMURA_SOURCE = {
  "id": "honmura-naoshima-v1",
  "name": "Honmura, Naoshima, Japan",
  "extentM": 1000,
  "projection": {
    "originLon": 133.994,
    "originLat": 34.464,
    "metersPerDegree": 111320,
    "referenceLatitude": 34.46,
    "northUp": true
  },
  "source": "https://www.openstreetmap.org/#map=17/34.4605/133.9975",
  "sourceApi": "https://api.openstreetmap.org/api/0.6/map?bbox=133.991,34.454,134.002,34.465",
  "retrievedAt": "2026-10-16",
  "sourceSha256": "8bd537ef493e36e00e8fae550a5c26ed743c0473c4e045f0e7d30910aa7a7f3a",
  "license": "ODbL-1.0",
  "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
  "attribution": "Map data © OpenStreetMap contributors",
  "reference": "https://naoshima.net/en/access-en/access_from/",
  "scope": "Curated simplified road graph. Public OSM way geometry and connectivity only. Buildings, capacities, responders, hazards, restrictions and traffic are synthetic demonstration data; not a navigation or evacuation map."
};
const junctions = [
  {
    "osmNode": "1761936883",
    "lon": 133.9981562,
    "lat": 34.4615183,
    "x": 381.48,
    "z": 276.26,
    "name": "Honmura Lane 01"
  },
  {
    "osmNode": "1761936889",
    "lon": 133.995909,
    "lat": 34.4614136,
    "x": 175.22,
    "z": 287.92,
    "name": "Honmura Lane 02"
  },
  {
    "osmNode": "2401899993",
    "lon": 133.9969757,
    "lat": 34.4613493,
    "x": 273.13,
    "z": 295.08,
    "name": "Honmura Lane 03"
  },
  {
    "osmNode": "457454136",
    "lon": 133.9985796,
    "lat": 34.4612913,
    "x": 420.34,
    "z": 301.53,
    "name": "Honmura Lane 04"
  },
  {
    "osmNode": "12616131051",
    "lon": 133.9984201,
    "lat": 34.4611533,
    "x": 405.7,
    "z": 316.89,
    "name": "Honmura Port approach"
  },
  {
    "osmNode": "1761936881",
    "lon": 133.9961853,
    "lat": 34.4610956,
    "x": 200.58,
    "z": 323.32,
    "name": "Honmura north lane"
  },
  {
    "osmNode": "12616131047",
    "lon": 133.9987345,
    "lat": 34.4609306,
    "x": 434.56,
    "z": 341.69,
    "name": "Honmura Lane 07"
  },
  {
    "osmNode": "1761936852",
    "lon": 133.9975676,
    "lat": 34.4608431,
    "x": 327.45,
    "z": 351.43,
    "name": "Honmura Lane 08"
  },
  {
    "osmNode": "2401899806",
    "lon": 133.9972512,
    "lat": 34.4607693,
    "x": 298.41,
    "z": 359.64,
    "name": "Honmura Lane 09"
  },
  {
    "osmNode": "2401899718",
    "lon": 133.9961446,
    "lat": 34.4606927,
    "x": 196.84,
    "z": 368.17,
    "name": "Honmura Lane 10"
  },
  {
    "osmNode": "4418564948",
    "lon": 133.996912,
    "lat": 34.4606579,
    "x": 267.28,
    "z": 372.04,
    "name": "Honmura Lane 11"
  },
  {
    "osmNode": "1761936837",
    "lon": 133.9961327,
    "lat": 34.4606364,
    "x": 195.75,
    "z": 374.44,
    "name": "Honmura Lane 12"
  },
  {
    "osmNode": "4418564945",
    "lon": 133.9965105,
    "lat": 34.460541,
    "x": 230.43,
    "z": 385.06,
    "name": "Honmura Lane 13"
  },
  {
    "osmNode": "1761936832",
    "lon": 133.9961405,
    "lat": 34.4605216,
    "x": 196.47,
    "z": 387.22,
    "name": "Honmura Lane 14"
  },
  {
    "osmNode": "1761936813",
    "lon": 133.9955586,
    "lat": 34.4602195,
    "x": 143.06,
    "z": 420.85,
    "name": "Honmura Lane 15"
  },
  {
    "osmNode": "4688290212",
    "lon": 133.9966092,
    "lat": 34.4601714,
    "x": 239.49,
    "z": 426.2,
    "name": "Honmura Lane 16"
  },
  {
    "osmNode": "1761936806",
    "lon": 133.9966237,
    "lat": 34.4601484,
    "x": 240.82,
    "z": 428.76,
    "name": "Honmura Lane 17"
  },
  {
    "osmNode": "1761936810",
    "lon": 133.9975429,
    "lat": 34.4601484,
    "x": 325.19,
    "z": 428.76,
    "name": "Honmura Lane 18"
  },
  {
    "osmNode": "4418564951",
    "lon": 133.9969449,
    "lat": 34.4601407,
    "x": 270.3,
    "z": 429.62,
    "name": "Honmura Lane 19"
  },
  {
    "osmNode": "1761936808",
    "lon": 133.9972117,
    "lat": 34.4601325,
    "x": 294.79,
    "z": 430.53,
    "name": "Honmura Lane 20"
  },
  {
    "osmNode": "1761936800",
    "lon": 133.9961968,
    "lat": 34.4601016,
    "x": 201.63,
    "z": 433.97,
    "name": "Honmura Lane 21"
  },
  {
    "osmNode": "892741680",
    "lon": 133.9952251,
    "lat": 34.4599613,
    "x": 112.45,
    "z": 449.59,
    "name": "Honmura west entrance"
  },
  {
    "osmNode": "4418564947",
    "lon": 133.9967394,
    "lat": 34.4596785,
    "x": 251.44,
    "z": 481.07,
    "name": "Town Office approach"
  },
  {
    "osmNode": "4418564952",
    "lon": 133.9969162,
    "lat": 34.4596785,
    "x": 267.67,
    "z": 481.07,
    "name": "Honmura Lane 24"
  },
  {
    "osmNode": "1761936734",
    "lon": 133.9971876,
    "lat": 34.4595781,
    "x": 292.58,
    "z": 492.25,
    "name": "Honmura Lane 25"
  },
  {
    "osmNode": "2401899362",
    "lon": 133.9984127,
    "lat": 34.4595058,
    "x": 405.02,
    "z": 500.29,
    "name": "Honmura Lane 26"
  },
  {
    "osmNode": "1761936730",
    "lon": 133.996406,
    "lat": 34.459397,
    "x": 220.84,
    "z": 512.41,
    "name": "Honmura Lane 27"
  },
  {
    "osmNode": "1761936708",
    "lon": 133.9965209,
    "lat": 34.459267,
    "x": 231.38,
    "z": 526.88,
    "name": "Honmura Lane 28"
  },
  {
    "osmNode": "12616160316",
    "lon": 133.9955245,
    "lat": 34.459234,
    "x": 139.93,
    "z": 530.55,
    "name": "Honmura Lane 29"
  },
  {
    "osmNode": "2401899357",
    "lon": 133.9969914,
    "lat": 34.4591802,
    "x": 274.57,
    "z": 536.54,
    "name": "Honmura Lane 30"
  },
  {
    "osmNode": "12616160313",
    "lon": 133.9952045,
    "lat": 34.4591155,
    "x": 110.56,
    "z": 543.74,
    "name": "Honmura Lane 31"
  },
  {
    "osmNode": "2401899356",
    "lon": 133.9965894,
    "lat": 34.4589754,
    "x": 237.67,
    "z": 559.34,
    "name": "Honmura Lane 32"
  },
  {
    "osmNode": "2401899355",
    "lon": 133.9968833,
    "lat": 34.4589743,
    "x": 264.65,
    "z": 559.46,
    "name": "Honmura Lane 33"
  },
  {
    "osmNode": "4418564953",
    "lon": 133.9956408,
    "lat": 34.4588896,
    "x": 150.6,
    "z": 568.89,
    "name": "Honmura Lane 34"
  },
  {
    "osmNode": "4418564954",
    "lon": 133.9965873,
    "lat": 34.4588623,
    "x": 237.48,
    "z": 571.93,
    "name": "Honmura Lane 35"
  },
  {
    "osmNode": "13607077249",
    "lon": 133.9965867,
    "lat": 34.4588352,
    "x": 237.42,
    "z": 574.95,
    "name": "Honmura Lane 36"
  },
  {
    "osmNode": "457454151",
    "lon": 133.9988539,
    "lat": 34.458639,
    "x": 445.52,
    "z": 596.79,
    "name": "Nokyo-mae junction"
  },
  {
    "osmNode": "1761936626",
    "lon": 133.9987647,
    "lat": 34.4586064,
    "x": 437.33,
    "z": 600.42,
    "name": "Honmura Lane 38"
  },
  {
    "osmNode": "892741251",
    "lon": 133.9965798,
    "lat": 34.4584683,
    "x": 236.79,
    "z": 615.79,
    "name": "Honmura south lane"
  },
  {
    "osmNode": "892741567",
    "lon": 133.9967061,
    "lat": 34.4584495,
    "x": 248.38,
    "z": 617.88,
    "name": "Honmura Lane 40"
  },
  {
    "osmNode": "12616090667",
    "lon": 133.9976451,
    "lat": 34.458398,
    "x": 334.57,
    "z": 623.61,
    "name": "Honmura Lane 41"
  },
  {
    "osmNode": "12616090666",
    "lon": 133.997665,
    "lat": 34.458364,
    "x": 336.39,
    "z": 627.4,
    "name": "Honmura Lane 42"
  },
  {
    "osmNode": "1761936592",
    "lon": 133.9984949,
    "lat": 34.4579028,
    "x": 412.57,
    "z": 678.74,
    "name": "Honmura Lane 43"
  }
];
const corridors = [{"osmWay":"75615713","from":21,"to":14,"highway":"unclassified","points":[[112.45,449.59],[118.93,444.03],[143.06,420.85]]},{"osmWay":"75615713","from":14,"to":13,"highway":"unclassified","points":[[143.06,420.85],[158.95,402.54],[172.68,388.92],[176.4,385.9],[179.78,384.33],[183.94,385.11],[196.47,387.22]]},{"osmWay":"75615713","from":13,"to":12,"highway":"unclassified","points":[[196.47,387.22],[221.83,386.26],[230.43,385.06]]},{"osmWay":"75615713","from":12,"to":10,"highway":"unclassified","points":[[230.43,385.06],[232.58,384.76],[238.73,383.37],[267.28,372.04]]},{"osmWay":"75615713","from":10,"to":8,"highway":"unclassified","points":[[267.28,372.04],[287.62,363.97],[298.41,359.64]]},{"osmWay":"75615713","from":8,"to":7,"highway":"unclassified","points":[[298.41,359.64],[327.45,351.43]]},{"osmWay":"75615713","from":7,"to":4,"highway":"unclassified","points":[[327.45,351.43],[343.09,346.32],[364.98,341.27],[377.59,336.91],[387.99,330.83],[396.37,324.68],[405.1,317.62],[405.7,316.89]]},{"osmWay":"75615713","from":4,"to":3,"highway":"unclassified","points":[[405.7,316.89],[414.55,306.31],[420.34,301.53]]},{"osmWay":"75615718","from":36,"to":37,"highway":"secondary","points":[[445.52,596.79],[438.75,599.45],[437.33,600.42]]},{"osmWay":"75615718","from":37,"to":40,"highway":"secondary","points":[[437.33,600.42],[399.98,606.57],[371.24,612.24],[359.55,615.77],[334.57,623.61]]},{"osmWay":"75615718","from":40,"to":39,"highway":"secondary","points":[[334.57,623.61],[322.86,627.29],[313.51,629.41],[305.29,630.03],[295.34,629.65],[284.96,627.47],[273.5,624.57],[248.38,617.88]]},{"osmWay":"75615718","from":39,"to":38,"highway":"secondary","points":[[248.38,617.88],[242.57,616.84],[236.79,615.79]]},{"osmWay":"75615718","from":38,"to":33,"highway":"secondary","points":[[236.79,615.79],[231.52,615.68],[174.39,613.02],[168.21,611.63],[163.37,608.0],[159.42,603.76],[156.82,595.4],[150.6,568.89]]},{"osmWay":"75615718","from":33,"to":28,"highway":"secondary","points":[[150.6,568.89],[147.15,554.17],[144.55,544.9],[139.93,530.55]]},{"osmWay":"75615718","from":28,"to":21,"highway":"secondary","points":[[139.93,530.55],[117.07,459.64],[112.45,449.59]]},{"osmWay":"136138680","from":36,"to":6,"highway":"tertiary","points":[[445.52,596.79],[438.86,573.28],[434.22,538.13],[433.87,528.5],[434.56,522.11],[437.5,514.08],[449.49,492.38],[452.6,483.49],[453.84,476.08],[453.29,467.93],[441.03,434.48],[438.45,423.41],[437.03,411.82],[434.42,348.02],[434.56,341.69]]},{"osmWay":"136138680","from":6,"to":3,"highway":"tertiary","points":[[434.56,341.69],[434.71,334.87],[435.13,315.07],[433.14,310.72],[424.58,304.09],[420.34,301.53]]},{"osmWay":"164574219","from":35,"to":34,"highway":"unclassified","points":[[237.42,574.95],[237.48,571.93]]},{"osmWay":"164574219","from":34,"to":31,"highway":"unclassified","points":[[237.48,571.93],[237.67,559.34]]},{"osmWay":"164574219","from":31,"to":27,"highway":"unclassified","points":[[237.67,559.34],[237.65,550.11],[235.69,536.76],[233.04,529.99],[231.38,526.88]]},{"osmWay":"164574219","from":27,"to":26,"highway":"unclassified","points":[[231.38,526.88],[220.84,512.41]]},{"osmWay":"164574234","from":2,"to":8,"highway":"unclassified","points":[[273.13,295.08],[296.32,349.4],[298.41,359.64]]},{"osmWay":"164574234","from":8,"to":19,"highway":"unclassified","points":[[298.41,359.64],[299.61,369.3],[294.79,430.53]]},{"osmWay":"164574234","from":19,"to":24,"highway":"unclassified","points":[[294.79,430.53],[293.88,461.23],[292.58,492.25]]},{"osmWay":"164574239","from":19,"to":17,"highway":"unclassified","points":[[294.79,430.53],[325.19,428.76]]},{"osmWay":"164574249","from":25,"to":17,"highway":"unclassified","points":[[405.02,500.29],[400.83,500.02],[395.08,498.38],[388.25,493.74],[383.33,487.72],[379.78,480.61],[377.05,473.23],[374.04,466.94],[371.85,459.84],[371.3,451.09],[372.39,438.79],[370.21,432.22],[365.22,429.92],[325.19,428.76]]},{"osmWay":"164574269","from":20,"to":26,"highway":"unclassified","points":[[201.63,433.97],[205.5,464.71],[220.84,512.41]]},{"osmWay":"164574276","from":19,"to":18,"highway":"service","points":[[294.79,430.53],[270.3,429.62]]},{"osmWay":"164574276","from":18,"to":16,"highway":"service","points":[[270.3,429.62],[240.82,428.76]]},{"osmWay":"164574287","from":26,"to":14,"highway":"unclassified","points":[[220.84,512.41],[198.41,518.48],[195.28,514.87],[172.43,466.46],[161.22,440.58],[143.06,420.85]]},{"osmWay":"164574289","from":13,"to":20,"highway":"unclassified","points":[[196.47,387.22],[197.74,402.49],[199.04,417.81],[201.63,433.97]]},{"osmWay":"164574326","from":0,"to":3,"highway":"tertiary","points":[[381.48,276.26],[390.22,279.09],[420.34,301.53]]},{"osmWay":"164574334","from":1,"to":5,"highway":"residential","points":[[175.22,287.92],[200.58,323.32]]},{"osmWay":"164574334","from":5,"to":9,"highway":"residential","points":[[200.58,323.32],[205.05,334.83],[205.43,347.64],[200.94,359.75],[196.84,368.17]]},{"osmWay":"164574338","from":24,"to":29,"highway":"residential","points":[[292.58,492.25],[288.09,506.11],[274.57,536.54]]},{"osmWay":"164574338","from":29,"to":32,"highway":"residential","points":[[274.57,536.54],[266.04,553.83],[264.65,559.46]]},{"osmWay":"164574338","from":32,"to":39,"highway":"residential","points":[[264.65,559.46],[256.88,590.85],[248.38,617.88]]},{"osmWay":"164574340","from":7,"to":17,"highway":"unclassified","points":[[327.45,351.43],[328.47,358.9],[328.4,379.0],[327.68,404.8],[325.19,428.76]]},{"osmWay":"164574349","from":37,"to":42,"highway":"unclassified","points":[[437.33,600.42],[435.42,608.11],[417.4,613.52],[401.29,664.14],[403.21,676.94],[412.57,678.74]]},{"osmWay":"231864288","from":5,"to":2,"highway":"unclassified","points":[[200.58,323.32],[228.6,313.19],[273.13,295.08]]},{"osmWay":"231864288","from":2,"to":0,"highway":"unclassified","points":[[273.13,295.08],[295.27,285.6],[303.97,304.35],[313.24,300.49],[319.62,302.61],[326.74,298.89],[358.24,282.44],[363.31,279.8],[381.48,276.26]]},{"osmWay":"231864293","from":11,"to":13,"highway":"residential","points":[[195.75,374.44],[196.47,387.22]]},{"osmWay":"231864295","from":9,"to":11,"highway":"residential","points":[[196.84,368.17],[195.75,374.44]]},{"osmWay":"231864296","from":31,"to":32,"highway":"residential","points":[[237.67,559.34],[264.65,559.46]]},{"osmWay":"231864304","from":27,"to":29,"highway":"residential","points":[[231.38,526.88],[245.26,527.83],[254.29,528.59],[263.89,533.06],[274.57,536.54]]},{"osmWay":"444372091","from":12,"to":15,"highway":"service","points":[[230.43,385.06],[239.49,426.2]]},{"osmWay":"444372091","from":15,"to":16,"highway":"service","points":[[239.49,426.2],[240.82,428.76]]},{"osmWay":"444372091","from":16,"to":22,"highway":"service","points":[[240.82,428.76],[245.16,461.0],[251.44,481.07]]},{"osmWay":"444372092","from":10,"to":18,"highway":"service","points":[[267.28,372.04],[270.7,384.55],[272.33,394.5],[270.3,429.62]]},{"osmWay":"444372092","from":18,"to":23,"highway":"service","points":[[270.3,429.62],[267.67,481.07]]},{"osmWay":"444372093","from":33,"to":34,"highway":"service","points":[[150.6,568.89],[237.48,571.93]]},{"osmWay":"474993323","from":15,"to":20,"highway":"service","points":[[239.49,426.2],[201.63,433.97]]},{"osmWay":"1362634671","from":4,"to":6,"highway":"residential","points":[[405.7,316.89],[413.78,322.42],[420.11,327.09],[424.11,329.37],[434.56,341.69]]},{"osmWay":"1362637724","from":28,"to":30,"highway":"service","points":[[139.93,530.55],[127.15,536.23],[115.21,539.43],[110.56,543.74]]},{"osmWay":"1362639229","from":40,"to":41,"highway":"service","points":[[334.57,623.61],[336.39,627.4]]},{"osmWay":"1483995550","from":38,"to":35,"highway":"unclassified","points":[[236.79,615.79],[237.42,574.95]]}];

export function honmuraRoads() {
  const nodes = junctions.map((node, index) => ({ ...node, id: `n${index}` }));
  const edges = [];
  for (const road of corridors) {
    const profile = road.highway === 'secondary' ? [8.3, 4, 10, 4000, 20000] :
      road.highway === 'tertiary' ? [6.9, 3, 7, 6000, 12000] : [4.2, 1, 4, 10000, 5000];
    const lengthM = Math.max(1, Math.round(road.points.slice(1).reduce((sum, p, i) =>
      sum + Math.hypot(p[0] - road.points[i][0], p[1] - road.points[i][1]), 0)));
    for (const reverse of [false, true]) {
      const from = `n${reverse ? road.to : road.from}`, to = `n${reverse ? road.from : road.to}`;
      const points = road.points.map(([x,z])=>({x,z}));
      if (reverse) points.reverse();
      edges.push({ id: `${from}:${to}`, from, to, points, lengthM,
        name: road.highway === 'secondary' ? 'Prefectural Route 256' :
          road.highway === 'tertiary' ? 'Honmura port road' : 'Honmura local lane',
        osmWay: road.osmWay, roadClass: road.highway === 'secondary' ? 'secondary' : 'local',
        speedMps: profile[0], capacity: profile[1], storage: profile[2], headwayMs: profile[3], maxWeight: profile[4],
        slope: 0, bridge: false, crossing: null, corridor: `${Math.min(road.from, road.to)}:${Math.max(road.from, road.to)}`,
        open: true, waterDepth: 0, nextEntryAt: 0, occupants: [], waiting: [], version: 1, trafficDemand: 35,
      });
    }
  }
  return { nodes, edges, crossings: [], river: null, source: structuredClone(HONMURA_SOURCE) };
}
