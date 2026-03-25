const avatarMap = {
  farmer1: require('../assets/farmer1.png'),
  farmer2: require('../assets/farmer2.png'),
  farmer3: require('../assets/farmer3.png'),
  farmer4: require('../assets/farmer4.png'),
  farmer5: require('../assets/farmer5.png'),
  farmer6: require('../assets/farmer6.png'),
};

export const DEFAULT_AVATAR_ID = 'farmer1';

export const AVATAR_OPTIONS = [
  { id: 'farmer1', label: 'Farmer 1' },
  { id: 'farmer2', label: 'Farmer 2' },
  { id: 'farmer3', label: 'Farmer 3' },
  { id: 'farmer4', label: 'Farmer 4' },
  { id: 'farmer5', label: 'Farmer 5' },
  { id: 'farmer6', label: 'Farmer 6' },
];

const validIds = new Set(Object.keys(avatarMap));

export const ensureValidAvatarId = (avatarId) =>
  (avatarId && validIds.has(avatarId) ? avatarId : DEFAULT_AVATAR_ID);

export const getAvatarSource = (avatarId) => avatarMap[ensureValidAvatarId(avatarId)];

