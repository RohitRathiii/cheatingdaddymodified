function removeTranscriptOverlap(previous, current, maxWords = 20) {
    const left = String(previous || '').trim().split(/\s+/);
    const right = String(current || '').trim().split(/\s+/);
    for (let count = Math.min(maxWords, left.length, right.length); count > 0; count--) {
        if (left.slice(-count).join(' ').toLowerCase() === right.slice(0, count).join(' ').toLowerCase()) return right.slice(count).join(' ');
    }
    return right.join(' ');
}

module.exports = { removeTranscriptOverlap };
