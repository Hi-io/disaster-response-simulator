// Only immutable archive descriptors/configuration cross back to the HTTP host.
// The complete physical checkpoint is still atomically persisted by its owner.
export function checkpointReceipt(snapshot) {
  return { manifest:snapshot.manifest,runId:snapshot.runId,now:snapshot.now,
    log:snapshot.log,state:{posts:snapshot.state.posts,messages:snapshot.state.messages} };
}
