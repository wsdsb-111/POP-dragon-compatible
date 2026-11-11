'use strict';

function preparePodScript(profileId, relative, buffer) {
  if (profileId !== 'wyvern-pod' || !/\.txt$/i.test(relative) || /(^|[\\/])mm_pod_legacy_torpor\.txt$/i.test(relative)) {
    return buffer;
  }

  const text = buffer.toString('utf8');
  const prepared = text.replace(/\bmm_royal_torpor\b(?![ \t]*=[ \t]*\{)/g, 'torpor');
  return prepared === text ? buffer : Buffer.from(prepared, 'utf8');
}

module.exports = { preparePodScript };
