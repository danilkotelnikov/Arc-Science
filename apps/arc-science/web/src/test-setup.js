import '@testing-library/jest-dom/vitest';
import {afterEach} from 'vitest';
import {cleanup} from '@testing-library/react';
afterEach(cleanup);
// jsdom has no layout observer; this is the browser boundary, not a UI mock.
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
// React Aria's selection indicator queries Web Animations; jsdom does not animate.
Element.prototype.getAnimations = () => [];
