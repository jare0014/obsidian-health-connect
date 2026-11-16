/** Parse a local calendar date/time without interpreting YYYY-MM-DD as UTC. */
export function parseNutritionLogTime(date: string, time: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
        throw new Error("Choose a valid date and time for this entry.");
    }
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const result = new Date(year, month - 1, day, hour, minute);
    if (result.getFullYear() !== year || result.getMonth() !== month - 1 ||
        result.getDate() !== day || result.getHours() !== hour || result.getMinutes() !== minute) {
        throw new Error("Choose a valid local date and time for this entry.");
    }
    return result;
}

export function nutritionLogInterval(loggedAt: Date) {
    if (!Number.isFinite(loggedAt.getTime())) throw new Error("Invalid nutrition entry time.");
    const midnight = new Date(loggedAt);
    midnight.setHours(0, 0, 0, 0);
    // Keep the entire interval on the selected day, including entries at midnight.
    const start = new Date(Math.max(midnight.getTime(), loggedAt.getTime() - 60000));
    const end = new Date(Math.max(start.getTime() + 1, loggedAt.getTime()));
    return {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        startUtcOffset: `${-start.getTimezoneOffset() * 60}s`,
        endUtcOffset: `${-end.getTimezoneOffset() * 60}s`
    };
}
