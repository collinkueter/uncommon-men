// Keep the fixture activity close to the September 22, 2026 demo capture.
// Lives apart from seed.ts so the store can migrate saved demo data without
// pulling the whole fixture into the main bundle.
export const DEMO_RECORDED_AT = Date.parse("2026-09-22T09:00:00-05:00");
