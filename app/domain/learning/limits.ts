/**
 * Shared bounds for learning content and its persisted progress. The catalog
 * and the repository must agree: a catalog that accepts more items than the
 * repository can store would produce state that can never be saved.
 */
export const MAX_ID_LENGTH = 200
export const MAX_COURSES = 200
export const MAX_LESSONS_PER_COURSE = 5_000
export const MAX_CHECKED_ITEMS = 500
