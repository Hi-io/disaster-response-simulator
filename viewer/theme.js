// The UI and both 3D views use the same visual tokens. No world data changes here.
const styles = getComputedStyle(document.documentElement);
const color = (token) => styles.getPropertyValue(`--${token}`).trim();
export const mapTheme = Object.freeze({
  background: color('background'),
  ground: color('map-ground'),
  road: color('map-road'),
  river: color('map-river'),
  light: color('map-light'),
  blue: color('blue'),
  violet: color('violet'),
  coral: color('coral'),
  amber: color('amber'),
  slate: color('slate'),
  buildings: {
    ordinary: color('map-building'),
    depot: color('map-depot'),
    shelter: color('map-shelter'),
    plant: color('map-plant'),
    operating: color('map-operating'),
    damaged: color('map-damaged'),
  },
  traffic: {
    clear: color('traffic-clear'),
    slow: color('traffic-slow'),
    heavy: color('traffic-heavy'),
    closed: color('traffic-closed'),
    unknown: color('map-road'),
  },
  organizations: ['blue', 'violet', 'cyan', 'amber', 'mint'].map(color),
});
