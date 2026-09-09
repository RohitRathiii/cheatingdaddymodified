function visibleAnswerRange(count, focusedIndex, limit = 30) {
    if (count <= limit) return { start: 0, end: count };
    if (focusedIndex < 0 || focusedIndex >= count - Math.floor(limit / 2)) {
        return { start: count - limit, end: count };
    }
    const start = Math.max(0, Math.min(count - limit, focusedIndex - Math.floor(limit / 2)));
    return { start, end: Math.min(count, start + limit) };
}

module.exports = { visibleAnswerRange };
