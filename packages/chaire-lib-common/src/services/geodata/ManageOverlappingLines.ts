import * as turf from '@turf/turf';
import MapboxGL from 'mapbox-gl';

import serviceLocator from '../../utils/ServiceLocator';

const zoomLimit: number = 14; //Zoom levels smaller than this will not apply line separation
let originalLayer; //Necessary so that offsets aren't applied to already offset lines after zoom

interface OverlappingSegments {
    geoData: string;
    crossingLines: number[];
    directions: boolean[];
}

export const manageOverlappingLines = () => {
    // const overlapMap = findOverlapingLines();
    // const overlapArray = manageOverlapingSegmentsData(overlapMap);
    // applyOffset(overlapArray);
};

export const manageZoom = (bounds: MapboxGL.LngLatBounds, zoom: number): void => {
    if (!originalLayer) { //Site does not load if original layer is initialized as a constant
        originalLayer = JSON.parse(JSON.stringify(serviceLocator.layerManager._layersByName['transitPaths'].source.data)); //Deep copy of original layer
    }

    if (zoom <= zoomLimit) {
        return;
    }

    const linesInView: any[] = [];
    const layerData = originalLayer;
    const features = layerData.features;
    for (let i = 0; i < features.length; i++) {
        for (let j = 0; j < features[i].geometry.coordinates.length; j++) {
            if (isInBounds(bounds, features[i].geometry.coordinates[j])) {
                linesInView.push(features[i]);
                break;
            }
        }
    }
    
    const overlapMap = findOverlapingLines(linesInView);
    const overlapArray = manageOverlapingSegmentsData(overlapMap);
    applyOffset(overlapArray);
    serviceLocator.eventManager.emit(
        'map.updateLayer',
        'transitPaths',
        serviceLocator.collectionManager.get('paths').toGeojson()
    );
}

const isInBounds = (bounds: MapboxGL.LngLatBounds, coord: number[]): boolean => {
    return bounds.contains(new MapboxGL.LngLat(coord[0], coord[1]));
}

const applyOffset = (overlapArray: OverlappingSegments[]) => {
    //console.log("i: " + overlapArray.length); 
    for (let i = 0; i < overlapArray.length; i++) {
        const nbOverlapped = overlapArray[i].directions.length;
        //console.log("j: " + nbOverlapped); 
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

const findOverlapingLines = (linesInView: any[]) => {
    // const layerData = serviceLocator.layerManager._layersByName['transitPaths'].source.data;
    // const features = layerData.features;
    const features = linesInView;
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
    serviceLocator.layerManager._layersByName['transitPaths'].source.data.features[lineIndex].geometry.coordinates =
        line.geometry.coordinates;
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

