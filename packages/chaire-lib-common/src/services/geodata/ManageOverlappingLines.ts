import * as turf from '@turf/turf';
import MapBoxGL from 'mapbox-gl';
import serviceLocator from '../../utils/ServiceLocator';


interface OverlappingSegments {
    geoData: string;
    crossingLines: number[];
    directions: boolean[];
}

export const manageOverlappingLines = () => {
    const overlapMap = findOverlapingLines();
    const overlapArray = manageOverlapingSegmentsData(overlapMap);
    applyOffset(overlapArray);
};

/////////////////////////// My modifications /////////////////////////////

export const relocateNodes = (nodeFeatures: any, nodeMap: Map<any, any>, pathFeatures: any) => {
   
    const relocatedNodes: any[] = [];
   
    nodeFeatures.features.forEach(nodeFeature => {
      const nodeId = nodeFeature.properties.id;
      const paths = nodeMap.get(nodeId);
      if (paths && paths.length > 1) {
        const pathCoords = paths.map(pathId => {
          const pathFeature = pathFeatures.features.find(feature => feature.id === pathId);
          return pathFeature.geometry.coordinates;
        });
        const nodeCoords = nodeFeature.geometry.coordinates;
        const closestPoints = findClosestPoints(nodeCoords, pathCoords);
        const middlePoint = findMiddlePoint(closestPoints);
        const modifiedNode = {
          type: "Feature",
          id: nodeFeature.id,
          geometry: {
            type: "Point",
            coordinates: middlePoint
          },
          properties: {
            id: nodeId,
            color: "#ff0000"
          }
        };
        if (!areCoordinatesEqual(modifiedNode.geometry.coordinates, nodeFeature.geometry.coordinates)) {
            for(let i = 0 ; i < nodeFeatures.features.length ; i++){
                if(nodeFeatures.features[i].properties.id == nodeId){
                    console.log("Found a correspondance :")
                    console.log("old Node :");
                    console.log(nodeFeatures.features[i]);
                    console.log("new node :");
                    console.log(modifiedNode);
                    serviceLocator.layerManager._layersByName['transitNodes'].source.data.features[i] = modifiedNode;
                }
            }            
            // serviceLocator.layerManager._layersByName['transitNodes'].source.data.features[nodeId].geometry.coordinates = modifiedNode.geometry.coordinates;
            relocatedNodes.push(modifiedNode);

            console.log("Node features")
            console.log(serviceLocator.layerManager._layersByName['transitNodes'].source.data.features)
            console.log("Relocated nodes")
            console.log(relocatedNodes)
        }
      }
    });

    serviceLocator.eventManager.emit(
        'map.updateLayer',
        'transitNodes',
        serviceLocator.collectionManager.get('nodes').toGeojson()
    );

    return {
      type: "FeatureCollection",
      features: relocatedNodes
    };
  }

  
  function areCoordinatesEqual(coords1: number[], coords2: number[]): boolean {
    return coords1[0] === coords2[0] && coords1[1] === coords2[1];
  }
  

function findClosestPoints(nodeCoords, pathCoords) {
  const closestPoints = pathCoords.map(path => {
    const line = turf.lineString(path);
    const nearestPoint = turf.nearestPointOnLine(line, nodeCoords);
    return nearestPoint.geometry.coordinates;
  });
  return closestPoints;
}

function findMiddlePoint(points) {
  const numPoints = points.length;
  const xCoords = points.map(point => point[0]);
  const yCoords = points.map(point => point[1]);
  const xSum = xCoords.reduce((sum, coord) => sum + coord, 0);
  const ySum = yCoords.reduce((sum, coord) => sum + coord, 0);
  const xMiddle = xSum / numPoints;
  const yMiddle = ySum / numPoints;
  return [xMiddle, yMiddle];
}

function getCrossingPaths(featureCollection) {
    const nodeMap = new Map();
    
    featureCollection.features.forEach(feature => {
      const nodes = feature.properties.nodes;
      nodes.forEach(node => {
        if (!nodeMap.has(node)) {
          nodeMap.set(node, [feature.id]);
        } else {
          const paths = nodeMap.get(node);
          paths.push(feature.id);
          nodeMap.set(node, paths);
        }
      });
    });
    
    return nodeMap;
  }

export const manageRelocatingNodes = () => {
    const transitPaths = serviceLocator.layerManager._layersByName['transitPaths'].source.data;
    const transitNodes = serviceLocator.layerManager._layersByName['transitNodes'].source.data; 
    const nodeMap = getCrossingPaths(transitPaths);
    const results = relocateNodes(transitNodes, nodeMap, transitPaths);
}

// const getNodeById = (nodeId: number): string => {
//     const layerData = serviceLocator.layerManager._layersByName['transitNodes'].source.data;
//     const features = layerData.features;
//     for (let i = 0; i < features.length; i++) {
//         if (features[i].properties.id === nodeId) {
//             return JSON.stringify(features[i]);
//         }
//     }
//     return '';
// };

// const getNodeIndexById = (nodeId: number): number => {
//     const layerData = serviceLocator.layerManager._layersByName['transitNodes'].source.data;
//     const features = layerData.features;
//     for (let i = 0; i < features.length; i++) {
//         if (features[i].id === nodeId) {
//             return i;
//         }
//     }
//     return -1;
// };


/////////////////////////////////////////////////


const applyOffset = (overlapArray: OverlappingSegments[]) => {
    for (let i = 0; i < overlapArray.length; i++) {
        const nbOverlapped = overlapArray[i].directions.length;
        let oppositeDirectionOffset = 0;
        let sameDirectionOffset = 0;
        for (let j = 0; j < nbOverlapped; j++) {
            const segment = overlapArray[i].geoData;
            if (overlapArray[i].directions[j]) {
                const offsetLine = turf.lineOffset(JSON.parse(segment), 3 * sameDirectionOffset, { units: 'meters' });
                replaceCoordinate(segment, JSON.stringify(offsetLine), overlapArray[i].crossingLines[j]);
                sameDirectionOffset++;
            } else {
                const reverseCoordinates = JSON.parse(segment).geometry.coordinates.slice().reverse();
                const reverseLine = JSON.parse(segment);
                reverseLine.geometry.coordinates = reverseCoordinates;
                const offsetLine = turf.lineOffset(reverseLine, 3 * oppositeDirectionOffset, { units: 'meters' });
                replaceCoordinate(
                    JSON.stringify(reverseLine),
                    JSON.stringify(offsetLine),
                    overlapArray[i].crossingLines[j]
                );
                oppositeDirectionOffset++;
            }
        }
    }
};

const findOverlapingLines = () => {
    const layerData = serviceLocator.layerManager._layersByName['transitPaths'].source.data;
    const features = layerData.features;
    const overlapMap: Map<string, Set<number>> = new Map();
    for (let i = 0; i < features.length - 1; i++) {
        for (let j = i + 1; j < features.length; j++) {
            const overlap = turf.lineOverlap(
                turf.lineString(features[i].geometry.coordinates),
                turf.lineString(features[j].geometry.coordinates)
            );
            if (overlap.features.length == 0) continue;
            for (const segment of overlap.features) {
                const overlapStr = JSON.stringify(segment);
                if (!overlapMap.has(overlapStr)) overlapMap.set(overlapStr, new Set());
                overlapMap.get(overlapStr)?.add(features[i].id).add(features[j].id);
            }
        }
    }
    return overlapMap;
};

const manageOverlapingSegmentsData = (overlapMap: Map<string, Set<number>>) => {
    const overlapArray: OverlappingSegments[] = [];
    overlapMap.forEach((value: any, key: any) => {
        const segmentDirections: Array<boolean> = [];
        value.forEach((id: number) => {
            const data = JSON.parse(getLineById(id));
            const coordinates = JSON.parse(key).geometry.coordinates;
            const firstPoint = coordinates[0];
            const lastPoint = coordinates[coordinates.length - 1];
            for (let i = 0; i < data.geometry.coordinates.length; i++) {
                const actualPoint = data.geometry.coordinates[i];
                if (actualPoint[0] == firstPoint[0] && actualPoint[1] == firstPoint[1]) {
                    segmentDirections.push(true);
                    break;
                } else if (actualPoint[0] == lastPoint[0] && actualPoint[1] == lastPoint[1]) {
                    segmentDirections.push(false);
                    break;
                }
            }
        });
        const overlap: OverlappingSegments = {
            geoData: key,
            crossingLines: Array.from(value),
            directions: segmentDirections
        };
        overlapArray.push(overlap);
    });
    return overlapArray;
};

const replaceCoordinate = (lineToReplace: string, offsetLine: string, lineId: number) => {
    const oldGeoData = JSON.parse(lineToReplace);
    const newGeoData = JSON.parse(offsetLine);
    const line = JSON.parse(getLineById(lineId));
    const oldCoordinates = oldGeoData.geometry.coordinates;
    const length = oldCoordinates.length;
    const firstPoint = oldCoordinates[0];
    for (let i = 0; i < line.geometry.coordinates.length; i++) {
        const actualPoint = line.geometry.coordinates[i];
        if (actualPoint[0] == firstPoint[0] && actualPoint[1] == firstPoint[1]) {
            for (let j = 0; j < length; j++) {
                line.geometry.coordinates[i + j] = newGeoData.geometry.coordinates[j];
            }
        }
    }
    const lineIndex = getLineIndexById(lineId);
    serviceLocator.layerManager._layersByName['transitPaths'].source.data.features[lineIndex].geometry.coordinates = line.geometry.coordinates;
};

const getLineById = (lineId: number): string => {
    const layerData = serviceLocator.layerManager._layersByName['transitPaths'].source.data;
    const features = layerData.features;
    for (let i = 0; i < features.length; i++) {
        if (features[i].id === lineId) {
            return JSON.stringify(features[i]);
        }
    }
    return '';
};

const getLineIndexById = (lineId: number): number => {
    const layerData = serviceLocator.layerManager._layersByName['transitPaths'].source.data;
    const features = layerData.features;
    for (let i = 0; i < features.length; i++) {
        if (features[i].id === lineId) {
            return i;
        }
    }
    return -1;
};
