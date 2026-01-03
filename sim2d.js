import { simulate as yarnSim } from "./yarnSimulation.yarnsim.js";
import * as d3 from 'd3';
import { ProcessModel } from './ProcessModel.js';
import { Pattern } from './Pattern.js';
import { YarnModel } from './YarnModel.js';
import { yarnLinkForce } from './YarnForce.js';

const X_PADDING = 1;
const Y_PADDING = 0;



export const SIM_PADDING = { X_PADDING, Y_PADDING };

export function simulateYarnSimFromModules(bimp, palette, scale) {
  const yarnSequence = ["yarn"];

  
  const sim = yarnSim(bimp, yarnSequence, palette, scale);
  function getState() {
    return {
      nodes: sim.nodes,
      yarnPath: sim.yarnPath,
      yarnPathLinks: sim.yarnPathLinks,
      yarnWidth: sim.yarnWidth,
      stitchHeight: sim.stitchHeight,
      canvasWidth: sim.canvasWidth,
      canvasHeight: sim.canvasHeight,
    };
  }

  return {
    relax: sim.relax,
    stopSim: sim.stopSim,
    getState,
  };

}
