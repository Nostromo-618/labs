/** Plain narration derived from the final, already validated visible response. */
export function speechText(value) {
  return String(value || '')
    .replace(/(^|\n)\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\s*\2[^\n]*(?=\n|$)|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[source:[^\]]*\]|\[\d+(?:\s*,\s*\d+)*\]/g, ' ')
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^[ \t]*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/[*_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Always advances; bounded chunks do not use Kokoro's TextSplitterStream. */
export function splitSpeechText(text, limit = 300, { oneSentence = false } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid speech chunk limit.');
  const chunks = [];
  let rest = String(text).trim();
  while (rest) {
    const firstSentence = oneSentence && rest.slice(0, limit).match(/[.!?]\s+/);
    if (firstSentence) {
      const end = firstSentence.index + 1;
      chunks.push(rest.slice(0, end));
      rest = rest.slice(end).trimStart();
      continue;
    }
    if (rest.length <= limit) {
      chunks.push(rest);
      break;
    }
    const prefix = rest.slice(0, limit);
    const sentences = [...prefix.matchAll(/[.!?]\s+/g)];
    const sentence = sentences.at(-1);
    let end = sentence ? sentence.index + 1 : prefix.lastIndexOf(' ');
    if (end < 1) end = limit;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trimStart();
  }
  return chunks;
}

export function splitSpeechTokens(tokens, separator, limit = 508) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid speech token limit.');
  const chunks = [];
  for (let start = 0; start < tokens.length;) {
    let end = Math.min(start + limit, tokens.length);
    if (end < tokens.length && separator != null) {
      for (let i = end - 1; i > start + Math.floor(limit / 2); i--) {
        if (tokens[i] === separator) {
          end = i + 1;
          break;
        }
      }
    }
    chunks.push(tokens.slice(start, end));
    start = end;
  }
  return chunks;
}

export function localEnglishVoices(synthesis = globalThis.speechSynthesis) {
  return (synthesis?.getVoices?.() || []).filter(
    (voice) => voice.localService === true && /^en(?:[-_]|$)/i.test(voice.lang),
  );
}
