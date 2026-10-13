// GPS freshness alone cannot order a received calendar revision: its declared
// schedule can change while the truck remains at exactly the same node/time.
export function acceptsVehicleReceipt(prior, incoming) {
  if (!prior) return true;
  if ((incoming.version ?? 0) < (prior.version ?? 0)) return false;
  if ((incoming.calendar?.version ?? 0) < (prior.calendar?.version ?? 0)) return false;
  return incoming.at >= prior.at;
}
