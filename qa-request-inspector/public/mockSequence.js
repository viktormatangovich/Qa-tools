export function nextMockResponse(rule, index) {
  const sequence = rule.sequence;
  if (!sequence?.length) return { response: rule, index: 0 };
  if (index >= sequence.length && rule.sequenceEnd === 'passthrough') return { response: null, index };
  const offset = rule.sequenceEnd === 'repeat' ? index % sequence.length : Math.min(index, sequence.length - 1);
  return { response: { ...rule, ...sequence[offset] }, index: index + 1 };
}
