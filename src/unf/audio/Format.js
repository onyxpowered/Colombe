export function pickFormat(formats, probe = document.createElement('audio')) {
  const can = {
    opus: probe.canPlayType('audio/ogg; codecs="opus"') || probe.canPlayType('audio/webm; codecs="opus"'),
    ogg: probe.canPlayType('audio/ogg; codecs="vorbis"') || probe.canPlayType('audio/ogg; codecs="opus"'),
    m4a: probe.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
    mp3: probe.canPlayType('audio/mpeg'),
  };
  for (const f of ['opus', 'ogg', 'm4a', 'mp3']) if (formats.includes(f) && can[f]) return f;
  return formats[0];
}
