import built from './playwright.built.config';

export default {...built, testIgnore: undefined, testMatch: '**/prism.spec.ts'};
