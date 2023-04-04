//import * as turf from '@turf/turf';
import MapboxGL from 'mapbox-gl';

import serviceLocator from '../../utils/ServiceLocator';
import { lineOffset, lineOverlap, lineString, LineString } from '@turf/turf';

const zoomLimit: number = 14; //Zoom levels smaller than this will not apply line separation
let originalLayer; //Necessary so that offsets aren't applied to already offset lines after zoom

interface OverlappingSegments {
    geoData: GeoJSON.Feature<LineString>;
    crossingLines: number[];
    directions: boolean[];
}



export const manageZoom = (bounds: MapboxGL.LngLatBounds, zoom: number): void => {
    if (!originalLayer) { //Site does not load if original layer is initialized as a constant
        originalLayer = JSON.parse(JSON.stringify(serviceLocator.layerManager._layersByName['transitPaths'].source.data)); //Deep copy of original layer
    }

    if (zoom <= zoomLimit) {
        return;
    }

    //serviceLocator.layerManager._layersByName['transitPaths'].source.data = originalLayer;
    //let start = Date.now();


    const linesInView: GeoJSON.FeatureCollection<LineString> = JSON.parse(JSON.stringify(originalLayer));
    linesInView.features = [];
    const features = originalLayer.features;
    for (let i = 0; i < features.length; i++) {
        for (let j = 0; j < features[i].geometry.coordinates.length; j++) {
            if (isInBounds(bounds, features[i].geometry.coordinates[j])) {
                linesInView.features.push(features[i])
                break;
            }
        }
    }
    //linesInView.features = features;
    //console.log("Found lines in view: " + (Date.now() - start).toString());
    const overlapMap = findOverlapingLines(linesInView);
    //console.log("Found overlapping lines: " + (Date.now() - start).toString());
    const overlapArray = manageOverlapingSegmentsData(overlapMap, linesInView);
    //console.log("Manage overlapping lines: " + (Date.now() - start).toString());
    const offsetLayer = applyOffset(overlapArray, linesInView);
    //console.log("Applied offset: " + (Date.now() - start).toString());
    serviceLocator.layerManager._layersByName['transitPaths'].source.data = cleanLines(offsetLayer);

    //const overlapArray = manageOverlapingSegmentsData(overlapMap, layerData);
    //const offsetLayer = applyOffset(overlapArray, layerData);
    serviceLocator.eventManager.emit(
        'map.updateLayer',
        'transitPaths',
        serviceLocator.collectionManager.get('paths').toGeojson()
    );
    //return cleanLines(offsetLayer);
}
    

const isInBounds = (bounds: MapboxGL.LngLatBounds, coord: number[]): boolean => {
    return bounds.contains(new MapboxGL.LngLat(coord[0], coord[1]));
}

export const manageOverlappingLines = (
    layerData: GeoJSON.FeatureCollection<LineString>
): GeoJSON.FeatureCollection<LineString> => {
    const overlapMap = findOverlapingLines(layerData);
    const overlapArray = manageOverlapingSegmentsData(overlapMap, layerData);
    const offsetLayer = applyOffset(overlapArray, layerData);
    return cleanLines(offsetLayer);
};

const cleanLines = (geojson: GeoJSON.FeatureCollection<LineString>): GeoJSON.FeatureCollection<LineString> => {
    geojson.features.forEach((feature) => {
        feature.geometry.coordinates = feature.geometry.coordinates.filter((value) => {
            return !Number.isNaN(value[0]) && !Number.isNaN(value[1]);
        });
    });
    return geojson;
};

const applyOffset = (
    overlapArray: OverlappingSegments[], 
    layerData: GeoJSON.FeatureCollection<LineString>
): GeoJSON.FeatureCollection<LineString> => {
    for (let i = 0; i < overlapArray.length; i++) {
        const nbOverlapped = overlapArray[i].directions.length;
        //console.log("j: " + nbOverlapped); 
        let oppositeDirectionOffset = 0;
        let sameDirectionOffset = 0;
        for (let j = 0; j < nbOverlapped; j++) {
            const segment = overlapArray[i].geoData;
            if (overlapArray[i].directions[j]) {
                const offsetLine = lineOffset(segment, 3 * sameDirectionOffset, { units: 'meters' });
                const replacedCoor = replaceCoordinate(segment, offsetLine, overlapArray[i].crossingLines[j], layerData);
                layerData.features[replacedCoor.index].geometry.coordinates = replacedCoor.coor;
                sameDirectionOffset++;
                // if (i === 0 && sameDirectionOffset === 1) {
                //     console.log(segment);
                //     console.log(offsetLine);
                //     console.log(replacedCoor);
                // }
            } else {
                const reverseCoordinates = segment.geometry.coordinates.slice().reverse();
                const reverseLine = segment;
                reverseLine.geometry.coordinates = reverseCoordinates;
                const offsetLine = lineOffset(reverseLine, 3 * oppositeDirectionOffset, { units: 'meters' });
                const replacedCoor = replaceCoordinate(reverseLine, offsetLine, overlapArray[i].crossingLines[j], layerData);
                layerData.features[replacedCoor.index].geometry.coordinates = replacedCoor.coor;
                oppositeDirectionOffset++;
                // if (i === 0 && oppositeDirectionOffset === 1) {
                //     console.log(reverseLine);
                //     console.log(offsetLine);
                //     console.log(replacedCoor);
                // }
            }
        }
    }
    return layerData;
};

const replaceCoordinate = (
    lineToReplace: GeoJSON.Feature<LineString>,
    offsetLine: GeoJSON.Feature<LineString>,
    lineId: number,
    layerData: GeoJSON.FeatureCollection<LineString>
): {index: number, coor: any} => {
    const line = getLineById(lineId, layerData);
    const oldCoordinates = lineToReplace.geometry.coordinates;
    const length = oldCoordinates.length;
    // We go through the coordinates of every single LineString until we reach the starting point of the segment we want to replace
    for (let i = 0; i < line.geometry.coordinates.length; i++) {
        let match = true;
        oldCoordinates.forEach((oldCoord, index) => {
            if (i + index >= line.geometry.coordinates.length) {
                match = false;
            } else {
                const lineCoord = line.geometry.coordinates[i + index];
                if (lineCoord[0] !== oldCoord[0] || lineCoord[1] !== oldCoord[1]) {
                    match = false;
                }
            }
        });

        if (match) {
            for (let j = 0; j < length; j++) {
                line.geometry.coordinates[i + j] = offsetLine.geometry.coordinates[j];
            }
            break;
        }
    }
    const lineIndex = getLineIndexById(lineId, layerData);
    //const geoData = layerData as any;
    layerData.features[lineIndex].geometry.coordinates = line.geometry.coordinates;
    return {index: lineIndex, coor: line.geometry.coordinates};
};

const findOverlapingLines = (layerData: GeoJSON.FeatureCollection<LineString>): Map<string, Set<number>> => {
    const features = layerData.features as any;
    // The map contains the feature and a set of numbers
    // The feature is the segment concerned by the overlap
    // The set of numbers is a set that contains the IDs of every single line concerned by the overlap on that segment
    const overlapMap: Map<string, Set<number>> = new Map();
    for (let i = 0; i < features.length - 1; i++) {
        for (let j = i + 1; j < features.length; j++) {
            const overlap = lineOverlap(
                lineString(features[i].geometry.coordinates),
                lineString(features[j].geometry.coordinates)
            );
            if (overlap.features.length === 0) continue;
            for (const segment of overlap.features) {
                const overlapStr = JSON.stringify(segment);
                if (!overlapMap.has(overlapStr)) overlapMap.set(overlapStr, new Set());
                overlapMap.get(overlapStr)?.add(features[i].id).add(features[j].id);
            }
        }
    }
    return overlapMap;
};

const manageOverlapingSegmentsData = (
    overlapMap: Map<string, Set<number>>,
    layerData: GeoJSON.FeatureCollection<LineString>
): OverlappingSegments[] => {
    const overlapArray: OverlappingSegments[] = [];
    overlapMap.forEach((value: any, key: any) => {
        const segmentDirections: Array<boolean> = [];
        const keyGeojson = JSON.parse(key);
        value.forEach((id: number) => {
            const data = getLineById(id, layerData);
            const coordinates = keyGeojson.geometry.coordinates;
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
            geoData: keyGeojson,
            crossingLines: Array.from(value),
            directions: segmentDirections
        };
        overlapArray.push(overlap);
    });
    return overlapArray;
};



const getLineById = (lineId: number, layerData: GeoJSON.FeatureCollection<LineString>): GeoJSON.Feature<LineString> => {
    const features = layerData.features as any;
    for (let i = 0; i < features.length; i++) {
        if (features[i].id === lineId) {
            return features[i];
        }
    }
    return {
        type: 'Feature',
        properties: {},
        geometry: {
            type: 'LineString',
            coordinates: []
        }
    };
};

const getLineIndexById = (lineId: number, layerData: GeoJSON.FeatureCollection<LineString>): number => {
    const features = layerData.features;
    for (let i = 0; i < features.length; i++) {
        if (features[i].id === lineId) {
            return i;
        }
    }
    return -1;
};

