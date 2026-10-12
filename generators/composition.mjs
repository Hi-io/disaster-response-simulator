/** Optional structural variation, applied before observations/reports. Nothing
 * here chooses a candidate action or changes a policy after seeing its loss. */
export function varyComposition(w) {
  if (w.config.compositionVariant === 'standard') return;
  for (const b of w.state.map.buildings.filter((b) => b.use === 'shelter')) {
    b.dependencies = { ...b.dependencies, water: 80 + Math.floor(w.random('composition', b.id, 'water') * 160), staff: 1 + Math.floor(w.random('composition', b.id, 'staff') * 2), sanitation: 1, energy: 1 };
    b.requiredStaffSkills = ['shelter_support'];
    if (w.config.compositionVariant === 'unsafe') { b.damage = 3; b.assessed = false; }
    if (w.config.compositionVariant === 'incompatible') b.requiredPower = { connector: 'B', powerKw: 18 };
    if (w.config.compositionVariant === 'occupied') b.capacity = 0;
    if (w.config.compositionVariant === 'delayed') b.dependencies.water += 300;
  }
  for (const r of w.state.resources.filter((r) => r.type === 'staff')) r.qualifications = w.config.compositionVariant === 'insufficient_staff' ? ['field_assessment'] : ['field_assessment', 'shelter_support', 'water_operations'];
  if (w.config.compositionVariant === 'distributed') {
    const owners = w.state.map.organizations;
    for (const type of ['energy', 'sanitation', 'staff']) {
      const selected = owners[Math.floor(w.random('composition', type, 'owner') * owners.length)];
      const resources = w.state.resources.filter((r) => r.type === type), total = resources.reduce((sum, r) => sum + r.quantity, 0);
      for (const r of resources) { r.quantity = r.owner === selected.id ? total : 0; r.initial = r.quantity; r.floor = 0; }
    }
  }
  for (const r of w.state.resources) w.observeResource(r.owner, r);
}
