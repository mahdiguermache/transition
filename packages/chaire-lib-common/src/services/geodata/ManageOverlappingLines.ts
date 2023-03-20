import { lineOffset, lineOverlap, lineString } from '@turf/turf';
import serviceLocator from '../../utils/ServiceLocator';

interface OverlappingSegments {
    geoData: GeoJSON.Feature<GeoJSON.LineString>;
    crossingLines: number[];
    directions: boolean[];
}

export const manageOverlappingLines = (layerData: GeoJSON.FeatureCollection): void => {
    const overlapMap = findOverlapingLines(layerData);
    const overlapArray = manageOverlapingSegmentsData(overlapMap, layerData);
    applyOffset(overlapArray, layerData);
};

const findOverlapingLines = (
    layerData: GeoJSON.FeatureCollection
): Map<GeoJSON.Feature<GeoJSON.LineString>, Set<number>> => {
    const features = layerData.features as any;
    // The map contains the feature and a set of numbers
    // The feature is the segment concerned by the overlap
    // The set of numbers is a set that contains the IDs of every single line concerned by the overlap on that segment
    const overlapMap: Map<GeoJSON.Feature<GeoJSON.LineString>, Set<number>> = new Map();
    for (let i = 0; i < features.length - 1; i++) {
        for (let j = i + 1; j < features.length; j++) {
            const overlap = lineOverlap(
                lineString(features[i].geometry.coordinates),
                lineString(features[j].geometry.coordinates)
            );
            if (overlap.features.length === 0) continue;
            for (const segment of overlap.features) {
                const overlap = segment;
                if (!overlapMap.has(overlap)) overlapMap.set(overlap, new Set());
                overlapMap.get(overlap)?.add(features[i].id).add(features[j].id);
            }
        }
    }
    return overlapMap;
};

const manageOverlapingSegmentsData = (
    overlapMap: Map<GeoJSON.Feature<GeoJSON.LineString>, Set<number>>,
    layerData: GeoJSON.FeatureCollection
): OverlappingSegments[] => {
    const overlapArray: OverlappingSegments[] = [];
    overlapMap.forEach((value: any, key: any) => {
        const segmentDirections: Array<boolean> = [];
        value.forEach((id: number) => {
            const data = getLineById(id, layerData);
            const coordinates = key.geometry.coordinates;
            const firstPoint = coordinates[0];
            const lastPoint = coordinates[coordinates.length - 1];
            for (let i = 0; i < data.geometry.coordinates.length; i++) {
                const actualPoint = data.geometry.coordinates[i];
                if (actualPoint[0] === firstPoint[0] && actualPoint[1] === firstPoint[1]) {
                    segmentDirections.push(true);
                    break;
                } else if (actualPoint[0] === lastPoint[0] && actualPoint[1] === lastPoint[1]) {
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

const applyOffset = (overlapArray: OverlappingSegments[], layerData: GeoJSON.FeatureCollection): void => {
    for (let i = 0; i < overlapArray.length; i++) {
        const nbOverlapped = overlapArray[i].directions.length;
        let oppositeDirectionOffset = 0;
        let sameDirectionOffset = 0;
        for (let j = 0; j < nbOverlapped; j++) {
            const segment = overlapArray[i].geoData;
            if (overlapArray[i].directions[j]) {
                const offsetLine = lineOffset(segment, 3 * sameDirectionOffset, { units: 'meters' });
                replaceCoordinate(segment, offsetLine, overlapArray[i].crossingLines[j], layerData);
                sameDirectionOffset++;
            } else {
                const reverseCoordinates = segment.geometry.coordinates.slice().reverse();
                const reverseLine = segment;
                reverseLine.geometry.coordinates = reverseCoordinates;
                const offsetLine = lineOffset(reverseLine, 3 * oppositeDirectionOffset, { units: 'meters' });
                replaceCoordinate(reverseLine, offsetLine, overlapArray[i].crossingLines[j], layerData);
                oppositeDirectionOffset++;
            }
        }
    }
};

const replaceCoordinate = (
    oldSegment: GeoJSON.Feature<GeoJSON.LineString>, 
    offsettedSegment: GeoJSON.Feature<GeoJSON.LineString>, 
    lineId: number,                                 
    layerData: GeoJSON.FeatureCollection            
): void => {
    const line = getLineById(lineId, layerData);  
    const oldSegmentCoordinates = oldSegment.geometry.coordinates;  
    const length = oldSegmentCoordinates.length; 
    const firstPoint = oldSegmentCoordinates[0];  
    // We go through the coordinates of every single LineString until we reach the starting point of the segment we want to replace
    for (let i = 0; i < line.geometry.coordinates.length; i++) {
        const actualPoint = line.geometry.coordinates[i];
        // We use this condition to know when the current point of the loop matches with the first point of the segment we want to replace
        // If the condition is verified we replace every subsequent point by the new coordinates with the applied offset
        if (actualPoint[0] === firstPoint[0] && actualPoint[1] === firstPoint[1]) {
            for (let j = 0; j < length; j++) {
                line.geometry.coordinates[i + j] = offsettedSegment.geometry.coordinates[j];
            }
        }
    }
    const lineIndex = getLineIndexById(lineId, layerData);
    serviceLocator.layerManager._layersByName['transitPaths'].source.data.features[lineIndex].geometry.coordinates =
        line.geometry.coordinates;
};

const getLineById = (lineId: number, layerData: GeoJSON.FeatureCollection): GeoJSON.Feature<GeoJSON.LineString> => {
    const features = layerData.features as any;
    const feature: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature',
        properties: {},
        geometry: {
            type: 'LineString',
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

const getLineIndexById = (lineId: number, layerData: GeoJSON.FeatureCollection): number => {
    const features = layerData.features;
    for (let i = 0; i < features.length; i++) {
        if (features[i].id === lineId) {
            return i;
        }
    }
    return -1;
};
