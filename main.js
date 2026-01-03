import { initUI, runSelfTests } from './ui.js';
import { init3D } from './view3d.js';

try {
  initUI();
  init3D();
  runSelfTests();
} catch (e) {
  console.error(e);
}
