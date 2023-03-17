import * as turf from '@turf/turf';
import { featureCollection as turfFeatureCollection } from '@turf/turf';
import serviceLocator from '../../utils/ServiceLocator';

interface OverlappingSegments {
    geoData: GeoJSON.Feature<GeoJSON.LineString>;
    crossingLines: number[];
    directions: boolean[];
}

export const manageOverlappingLines = ():void => {
    const overlapMap = findOverlapingLines();
    const overlapArray = manageOverlapingSegmentsData(overlapMap);
    applyOffset(overlapArray);
};


const findOverlapingLines = ():Map<GeoJSON.Feature<GeoJSON.LineString>, Set<number>> => {
    const layerData = serviceLocator.layerManager._layersByName['transitPaths'].source.data;
    const features = layerData.features;
    const overlapMap: Map<GeoJSON.Feature<GeoJSON.LineString>, Set<number>> = new Map();
    for (let i = 0; i < features.length - 1; i++) {
        for (let j = i + 1; j < features.length; j++) {
            const overlap = turf.lineOverlap(
                turf.lineString(features[i].geometry.coordinates),
                turf.lineString(features[j].geometry.coordinates)
            );
            if (overlap.features.length == 0) continue;
            for (const segment of overlap.features) {
                const overlap = segment;
                if (!overlapMap.has(overlap)) overlapMap.set(overlap, new Set());
                overlapMap.get(overlap)?.add(features[i].id).add(features[j].id);
            }
        }
    }
    return overlapMap;
};

const manageOverlapingSegmentsData = (overlapMap: Map<GeoJSON.Feature<GeoJSON.LineString>, Set<number>>):OverlappingSegments[] => {
    const overlapArray: OverlappingSegments[] = [];
    overlapMap.forEach((value: any, key: any) => {
        const segmentDirections: Array<boolean> = [];
        value.forEach((id: number) => {
            const data = getLineById(id);
            const coordinates = key.geometry.coordinates;
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

const applyOffset = (overlapArray: OverlappingSegments[]):void => {
    for (let i = 0; i < overlapArray.length; i++) {
        const nbOverlapped = overlapArray[i].directions.length;
        let oppositeDirectionOffset = 0;
        let sameDirectionOffset = 0;
        for (let j = 0; j < nbOverlapped; j++) {
            const segment = overlapArray[i].geoData;
            if (overlapArray[i].directions[j]) {
                const offsetLine = turf.lineOffset(segment, 3 * sameDirectionOffset, { units: 'meters' });
                replaceCoordinate(segment, offsetLine, overlapArray[i].crossingLines[j]);
                sameDirectionOffset++;
            } else {
                const reverseCoordinates = segment.geometry.coordinates.slice().reverse();
                const reverseLine = segment;
                reverseLine.geometry.coordinates = reverseCoordinates;
                const offsetLine = turf.lineOffset(reverseLine, 3 * oppositeDirectionOffset, { units: 'meters' });
                replaceCoordinate(
                    reverseLine,
                    offsetLine,
                    overlapArray[i].crossingLines[j]
                );
                oppositeDirectionOffset++;
            }
        }
    }
};


const replaceCoordinate = (lineToReplace: GeoJSON.Feature<GeoJSON.LineString>, offsetLine: GeoJSON.Feature<GeoJSON.LineString>, lineId: number):void => {
    const line = getLineById(lineId);
    const oldCoordinates = lineToReplace.geometry.coordinates;
    const length = oldCoordinates.length;
    const firstPoint = oldCoordinates[0];
    for (let i = 0; i < line.geometry.coordinates.length; i++) {
        const actualPoint = line.geometry.coordinates[i];
        if (actualPoint[0] == firstPoint[0] && actualPoint[1] == firstPoint[1]) {
            for (let j = 0; j < length; j++) {
                line.geometry.coordinates[i + j] = offsetLine.geometry.coordinates[j];
            }
        }
    }
    const lineIndex = getLineIndexById(lineId);
    serviceLocator.layerManager._layersByName['transitPaths'].source.data.features[lineIndex].geometry.coordinates =
        line.geometry.coordinates;
};

const getLineById = (lineId: number): GeoJSON.Feature<GeoJSON.LineString> => {
    const layerData = serviceLocator.layerManager._layersByName['transitPaths'].source.data;
    const features = layerData.features;
    const lineString: GeoJSON.LineString = {
        type: "LineString",
        coordinates: []
      };
    const feature: GeoJSON.Feature<GeoJSON.LineString> = {
        type: "Feature",
        properties: { },
        geometry: {
            type: "LineString",
            coordinates: []
          }
    };
    for (let i = 0; i < features.length; i++) {
        if (features[i].id === lineId) {
            return features[i];
        }
    }
    return feature;
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