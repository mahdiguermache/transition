/*
 * Copyright 2022, Polytechnique Montreal and contributors
 *
 * This file is licensed under the MIT License.
 * License text available at https://opensource.org/licenses/MIT
 */
import React from 'react';
import ReactDom from 'react-dom';
import { withTranslation } from 'react-i18next';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import { default as elementResizedEvent, unbind as removeResizeListener } from 'element-resize-event';

import Preferences from 'chaire-lib-common/lib/config/Preferences';
import layersConfig from '../../config/layers.config';
import globalMapEvents from 'chaire-lib-frontend/lib/services/map/events/GlobalMapEvents';
import transitionMapEvents from '../../services/map/events';
import mapCustomEvents from '../../services/map/events/MapRelatedCustomEvents';
import MapLayerManager from 'chaire-lib-frontend/lib/services/map/MapLayerManager';
import PathMapLayerManager from '../../services/map/PathMapLayerManager';
import MapPopupManager from 'chaire-lib-frontend/lib/services/map/MapPopupManager';
import serviceLocator from 'chaire-lib-common/lib/utils/ServiceLocator';
import { getMapBoxDraw, removeMapBoxDraw } from 'chaire-lib-frontend/lib/services/map/MapPolygonService';
import { findOverlappingFeatures } from 'chaire-lib-common/lib/services/geodata/FindOverlappingFeatures';
import Node from 'transition-common/lib/services/nodes/Node';
import ConfirmModal from 'chaire-lib-frontend/lib/components/modal/ConfirmModal';
import _cloneDeep from 'lodash.clonedeep';
import { featureCollection as turfFeatureCollection } from '@turf/turf';
import { LayoutSectionProps } from 'chaire-lib-frontend/lib/services/dashboard/DashboardContribution';
import { MapEventHandlerDescription } from 'chaire-lib-frontend/lib/services/map/IMapEventHandler';
import maplibregl from 'maplibre-gl';
import { LngLatBoundsLike } from 'maplibre-gl';

export interface MainMapProps extends LayoutSectionProps {
    zoom: number;
    center: [number, number];
    // TODO : put layers and events together in an application configuration received as props here
    // layersConfig: { [key: string]: any };
    // mapEvents: MapEventHandlerDescription[];
    // customEvents: any;
}

interface MainMapState {
    layers: string[];
    confirmModalDeleteIsOpen: boolean;
}

/**
 * TODO: For now, hard code the map for Transition here. But it should be in
 * chaire-lib and offer the possibility to pass the application modules when the
 * API for it has stabilised.
 */
class MainMap extends React.Component<MainMapProps, MainMapState> {
    private layerManager: MapLayerManager;
    private pathLayerManager: PathMapLayerManager;
    private defaultZoomArray: [number];
    private defaultCenter: [number, number];
    private mapEvents: { [key: string]: { [key: string]: MapEventHandlerDescription[] } };
    private map: maplibregl.Map | undefined;
    private popupManager: MapPopupManager;
    private mapContainer;
    private draw: MapboxDraw | undefined;

    constructor(props: MainMapProps) {
        super(props);

        this.state = {
            layers: Preferences.current.map.layers[this.props.activeSection],
            confirmModalDeleteIsOpen: false
        };

        this.defaultZoomArray = [props.zoom];
        this.defaultCenter = props.center;
        this.layerManager = new MapLayerManager(layersConfig);
        this.pathLayerManager = new PathMapLayerManager(this.layerManager);

        this.popupManager = new MapPopupManager();
        this.mapContainer = HTMLElement;

        this.mapEvents = {};
        const newEvents = [globalMapEvents, transitionMapEvents];
        const newEventsArr = newEvents.flatMap((ev) => ev);
        newEventsArr.forEach((eventDescriptor) => {
            this.mapEvents[eventDescriptor.eventName] = this.mapEvents[eventDescriptor.eventName] || {};
            if (eventDescriptor.type === 'layer') {
                const events = this.mapEvents[eventDescriptor.eventName][eventDescriptor.layerName] || [];
                events.push(eventDescriptor);
                this.mapEvents[eventDescriptor.eventName][eventDescriptor.layerName] = events;
            } else {
                const events = this.mapEvents[eventDescriptor.eventName]['map'] || [];
                events.push(eventDescriptor);
                this.mapEvents[eventDescriptor.eventName]['map'] = events;
            }
        });
    }

    fitBounds = (coordinates: LngLatBoundsLike) => {
        this.map?.fitBounds(coordinates, {
            padding: 20,
            bearing: this.map.getBearing()
        });
    };

    setCenter = (coordinates: [number, number]) => {
        this.map?.setCenter(coordinates);
    };

    onEnableBoxZoom = () => {
        this.map?.boxZoom.enable();
    };

    onDisableBoxZoom = () => {
        this.map?.boxZoom.disable();
    };

    onEnableDragPan = () => {
        this.map?.dragPan.enable();
    };

    onDisableDragPan = () => {
        this.map?.dragPan.disable();
    };

    setMap = (e: maplibregl.MapLibreEvent) => {
        this.layerManager.setMap(e.target);
        this.popupManager.setMap(e.target);
        this.layerManager.updateEnabledLayers(this.state.layers);
        if (process.env.CUSTOM_RASTER_TILES_XYZ_URL && this.map) {
            const mapLayers = this.map.getStyle().layers || [];
            let beforeLayerId = mapLayers.length > 0 ? mapLayers[0].id : undefined;

            for (let i = 0, count = mapLayers.length; i < count; i++) {
                const layer = mapLayers[i];
                if (layer.type === 'background') {
                    beforeLayerId = layer.id;
                    break;
                }
            }

            if (beforeLayerId) {
                this.map.addSource('custom_tiles', {
                    type: 'raster',
                    tiles: [process.env.CUSTOM_RASTER_TILES_XYZ_URL],
                    tileSize: 256
                });
                this.map?.addLayer(
                    {
                        id: 'custom_tiles',
                        type: 'raster',
                        source: 'custom_tiles',
                        minzoom: process.env.CUSTOM_RASTER_TILES_MIN_ZOOM
                            ? parseFloat(process.env.CUSTOM_RASTER_TILES_MIN_ZOOM)
                            : 0,
                        maxzoom: process.env.CUSTOM_RASTER_TILES_MAX_ZOOM
                            ? parseFloat(process.env.CUSTOM_RASTER_TILES_MAX_ZOOM)
                            : 22
                    },
                    beforeLayerId
                );
            }
        }

        serviceLocator.eventManager.emit('map.loaded');
    };

    showPathsByAttribute = (attribute: string, value: any) => {
        // attribute must be agency_id or line_id
        if (attribute === 'agency_id') {
            this.pathLayerManager.showAgencyId(value);
        } else if (attribute === 'line_id') {
            this.pathLayerManager.showLineId(value);
        }
    };

    hidePathsByAttribute = (attribute: string, value: any) => {
        // attribute must be agency_id or line_id
        if (attribute === 'agency_id') {
            this.pathLayerManager.hideAgencyId(value);
        } else if (attribute === 'line_id') {
            this.pathLayerManager.hideLineId(value);
        }
    };

    clearPathsFilter = () => {
        this.pathLayerManager.clearFilter();
    };

    componentDidMount = () => {
        this.map = new maplibregl.Map({
            container: this.mapContainer,
            style: 'https://api.maptiler.com/maps/streets-v2/style.json?key=KCeJQzbtFLZLuRRf900z',
            center: this.defaultCenter,
            zoom: this.defaultZoomArray[0],
            maxZoom: 20,
            hash: true
        });

        this.map.addControl(new maplibregl.ScaleControl({maxWidth: undefined}), 'bottom-right');

        for (const eventName in this.mapEvents) {
            for (const layerName in this.mapEvents[eventName]) {
                if (layerName === 'map') {
                    this.map.on(eventName, this.getEventHandler(this.mapEvents[eventName][layerName]));
                } else {
                    this.map.on(
                        eventName as any,
                        layerName,
                        this.getEventHandler(this.mapEvents[eventName][layerName])
                    );
                }
            }
        }
        this.map.on('load', this.setMap);
        serviceLocator.addService('layerManager', this.layerManager);
        serviceLocator.addService('pathLayerManager', this.pathLayerManager);
        mapCustomEvents.addEvents(serviceLocator.eventManager);
        elementResizedEvent(this.mapContainer, this.onResizeContainer);
        serviceLocator.eventManager.on('map.updateEnabledLayers', this.updateEnabledLayers);
        serviceLocator.eventManager.on('map.updateLayer', this.updateLayer);
        serviceLocator.eventManager.on('map.updateLayers', this.updateLayers);
        serviceLocator.eventManager.on('map.addPopup', this.addPopup);
        serviceLocator.eventManager.on('map.removePopup', this.removePopup);
        serviceLocator.eventManager.on('map.updateFilter', this.updateFilter);
        serviceLocator.eventManager.on('map.clearFilter', this.clearFilter);
        serviceLocator.eventManager.on('map.showLayer', this.showLayer);
        serviceLocator.eventManager.on('map.hideLayer', this.hideLayer);
        serviceLocator.eventManager.on('map.paths.byAttribute.show', this.showPathsByAttribute);
        serviceLocator.eventManager.on('map.paths.byAttribute.hide', this.hidePathsByAttribute);
        serviceLocator.eventManager.on('map.paths.clearFilter', this.clearPathsFilter);
        serviceLocator.eventManager.on('map.fitBounds', this.fitBounds);
        serviceLocator.eventManager.on('map.setCenter', this.setCenter);
        serviceLocator.eventManager.on('map.enableBoxZoom', this.onEnableBoxZoom);
        serviceLocator.eventManager.on('map.disableBoxZoom', this.onDisableBoxZoom);
        serviceLocator.eventManager.on('map.enableDragPan', this.onEnableDragPan);
        serviceLocator.eventManager.on('map.disableDragPan', this.onDisableDragPan);
        serviceLocator.eventManager.on('map.showContextMenu', this.showContextMenu);
        serviceLocator.eventManager.on('map.hideContextMenu', this.hideContextMenu);
        serviceLocator.eventManager.on('map.handleDrawControl', this.handleDrawControl);
        serviceLocator.eventManager.on('map.deleteSelectedNodes', this.deleteSelectedNodes);
        serviceLocator.eventManager.on('map.deleteSelectedPolygon', this.deleteSelectedPolygon);
    };

    componentWillUnmount = () => {
        serviceLocator.removeService('layerManager');
        serviceLocator.removeService('pathLayerManager');
        mapCustomEvents.removeEvents(serviceLocator.eventManager);
        removeResizeListener(this.mapContainer, this.onResizeContainer);
        serviceLocator.eventManager.off('map.updateEnabledLayers', this.updateEnabledLayers);
        serviceLocator.eventManager.off('map.updateLayer', this.updateLayer);
        serviceLocator.eventManager.off('map.updateLayers', this.updateLayers);
        serviceLocator.eventManager.off('map.addPopup', this.addPopup);
        serviceLocator.eventManager.off('map.removePopup', this.removePopup);
        serviceLocator.eventManager.off('map.updateFilter', this.updateFilter);
        serviceLocator.eventManager.off('map.clearFilter', this.clearFilter);
        serviceLocator.eventManager.off('map.showLayer', this.showLayer);
        serviceLocator.eventManager.off('map.hideLayer', this.hideLayer);
        serviceLocator.eventManager.off('map.paths.byAttribute.show', this.showPathsByAttribute);
        serviceLocator.eventManager.off('map.paths.byAttribute.hide', this.hidePathsByAttribute);
        serviceLocator.eventManager.off('map.paths.clearFilter', this.clearPathsFilter);
        serviceLocator.eventManager.off('map.fitBounds', this.fitBounds);
        serviceLocator.eventManager.off('map.setCenter', this.setCenter);
        serviceLocator.eventManager.off('map.enableBoxZoom', this.onEnableBoxZoom);
        serviceLocator.eventManager.off('map.disableBoxZoom', this.onDisableBoxZoom);
        serviceLocator.eventManager.off('map.enableDragPan', this.onEnableDragPan);
        serviceLocator.eventManager.off('map.disableDragPan', this.onDisableDragPan);
        serviceLocator.eventManager.off('map.showContextMenu', this.showContextMenu);
        serviceLocator.eventManager.off('map.hideContextMenu', this.hideContextMenu);
        serviceLocator.eventManager.off('map.handleDrawControl', this.handleDrawControl);
        serviceLocator.eventManager.off('map.deleteSelectedNodes', this.deleteSelectedNodes);
        serviceLocator.eventManager.off('map.deleteSelectedPolygon', this.deleteSelectedPolygon);
        this.map?.remove(); // this will clean up everything including events
    };

    onResizeContainer = () => {
        if (this.map) {
            this.map.resize();
        }
    };

    private executeEvents = (e, events: MapEventHandlerDescription[]) => {
        if (e.originalEvent && e.originalEvent.cancelBubble === true) {
            return;
        }
        for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
            const event = events[eventIndex];
            if (event.condition === undefined || event.condition(this.props.activeSection)) {
                event.handler(e);
            }
            if (e.originalEvent && e.originalEvent.cancelBubble === true) {
                break;
            }
        }
    };

    getEventHandler = (events: MapEventHandlerDescription[]) => {
        return (e) => this.executeEvents(e, events);
    };

    showLayer = (layerName: string) => {
        this.layerManager.showLayer(layerName);
    };

    hideLayer = (layerName: string) => {
        this.layerManager.hideLayer(layerName);
    };

    clearFilter = (layerName: string) => {
        this.layerManager.clearFilter(layerName);
    };

    updateFilter = (layerName: string, filter) => {
        this.layerManager.updateFilter(layerName, filter);
    };

    setRef = (ref) => {
        this.mapContainer = ref;
    };

    setDrawPolygonService = () => {
        const map = this.map;
        if (!map) return;
        this.draw = getMapBoxDraw(
            map,
            (data) => {
                this.modeChangePolygonService(data);
            },
            (polygon) => {
                this.handleDrawPolygonService(polygon);
            },
            (polygon) => {
                /* Nothing to do */
            }
        );
    };

    /**
     * In the nodes active section, if you click on the map a new node will be create
     * If the user click on the tool for draw a polygon,
     * selectedNodes will put a value that will prevent a new node to be create
     * If the user click again on the tool for draw a polygon and selectedNodes does'nt contain nodes (type object)
     * selectedNodes will be clear so a new node can be create
     * @param {object} data The next mode, i.e. the mode that Draw is changing to (from mapbox-gl-draw API.md)
     */
    modeChangePolygonService = (data) => {
        if (data.mode && data.mode === 'draw_polygon') {
            serviceLocator.selectedObjectsManager.select('selectedNodes', 'draw_polygon');
        } else {
            const selectedNodes = serviceLocator.selectedObjectsManager.get('selectedNodes');
            if (selectedNodes && typeof selectedNodes !== 'object' && data.mode && data.mode === 'simple_select') {
                serviceLocator.selectedObjectsManager.select('selectedNodes', null);
            }
        }
    };

    handleDrawPolygonService = (polygon) => {
        if (this.props.activeSection === 'nodes') {
            const allNodes = serviceLocator.collectionManager.get('nodes').getFeatures();
            const nodesInPolygon = findOverlappingFeatures(polygon, allNodes);
            const selectedNodes = nodesInPolygon
                .map((node) => {
                    return new Node(node.properties || {}, false, serviceLocator.collectionManager);
                })
                .filter((node) => {
                    return node.get('is_frozen', false) === false && !node.wasFrozen();
                });
            const geojson = selectedNodes.map((node) => {
                return _cloneDeep(node.toGeojson());
            });

            serviceLocator.eventManager.emit('map.updateLayers', {
                transitNodesSelected: turfFeatureCollection(geojson)
            });
            serviceLocator.selectedObjectsManager.select('selectedNodes', selectedNodes);
            serviceLocator.selectedObjectsManager.select(
                'isContainSelectedFrozenNodes',
                selectedNodes.length !== nodesInPolygon.length
            );
            serviceLocator.selectedObjectsManager.select('isDrawPolygon', true);
        }
    };

    deleteSelectedPolygon = () => {
        if (this.draw) {
            this.draw.deleteAll().getAll();
        }
        serviceLocator.selectedObjectsManager.select('selectedNodes', null);
        serviceLocator.selectedObjectsManager.select('isContainSelectedFrozenNodes', null);
        serviceLocator.selectedObjectsManager.select('isDrawPolygon', null);
        serviceLocator.eventManager.emit('selected.update.nodes');
        serviceLocator.eventManager.emit('map.updateLayers', {
            transitNodesSelected: turfFeatureCollection([]),
            transitNodes250mRadius: turfFeatureCollection([]),
            transitNodes500mRadius: turfFeatureCollection([]),
            transitNodes750mRadius: turfFeatureCollection([]),
            transitNodes1000mRadius: turfFeatureCollection([]),
            transitNodesRoutingRadius: turfFeatureCollection([])
        });
    };

    deleteSelectedNodes = () => {
        this.setState({
            confirmModalDeleteIsOpen: true
        });
    };

    onDeleteSelectedNodes = () => {
        serviceLocator.eventManager.emit('progress', { name: 'DeletingNode', progress: 0.0 });
        const selectedNodes = serviceLocator.selectedObjectsManager.get('selectedNodes');

        Promise.all(
            selectedNodes.map((node: Node) => {
                return node.delete(serviceLocator.socketEventManager);
            })
        ).then((response) => {
            serviceLocator.selectedObjectsManager.deselect('node');
            serviceLocator.collectionManager.refresh('nodes');
            serviceLocator.eventManager.emit('map.updateLayers', {
                transitNodes: serviceLocator.collectionManager.get('nodes').toGeojson(),
                transitNodesSelected: turfFeatureCollection([])
            });
        });
        this.deleteSelectedPolygon();
        serviceLocator.eventManager.emit('progress', { name: 'DeletingNode', progress: 1.0 });
    };

    handleDrawControl = (section: string) => {
        const map = this.map;
        if (!map) return;
        if (section === 'nodes' && !this.draw) {
            this.setDrawPolygonService();
        } else if (section !== 'nodes' && this.draw) {
            this.deleteSelectedPolygon();
            removeMapBoxDraw(
                map,
                this.draw,
                () => {
                    /* Nothing to do */
                },
                () => {
                    /* Nothing to do */
                },
                () => {
                    /* Nothing to do */
                }
            );
            this.draw = null;
        }
    };

    addPopup = (popupId: string, popup: maplibregl.Popup, removeAll = true) => {
        this.hideContextMenu();
        if (removeAll) {
            this.removeAllPopups();
        }
        this.popupManager.addPopup(popupId, popup);
    };

    removePopup = (popupId: string) => {
        this.popupManager.removePopup(popupId);
    };

    removeAllPopups = () => {
        this.popupManager.removeAllPopups();
    };

    updateLayer = (layerName: string, geojson: GeoJSON.FeatureCollection) => {
        //console.log('updating map layer', layerName, geojson);
        this.layerManager.updateLayer(layerName, geojson);
    };

    updateLayers = (geojsonByLayerName) => {
        //console.log('updating map layers', Object.keys(geojsonByLayerName));
        this.layerManager.updateLayers(geojsonByLayerName);
    };

    updateEnabledLayers = (enabledLayers: string[]) => {
        this.layerManager.updateEnabledLayers(enabledLayers);
    };

    showContextMenu = (e, elements) => {
        const contextMenu = document.getElementById('tr__main-map-context-menu');
        if (!contextMenu) {
            return;
        }
        contextMenu.style.left = e.point.x + 'px';
        contextMenu.style.top = e.point.y + 'px';
        contextMenu.style.display = 'block';

        ReactDom.render(
            <ul>
                {elements.map((element) => (
                    <li
                        key={element.key ? element.key : element.title}
                        style={{ display: 'block', padding: '5px' }}
                        onClick={() => {
                            element.onClick();
                            contextMenu.style.display = 'none';
                        }}
                        onMouseOver={() => element.onHover && element.onHover()}
                    >
                        {this.props.t(element.title)}
                    </li>
                ))}
            </ul>,
            contextMenu
        );
    };

    hideContextMenu = () => {
        const contextMenu = document.getElementById('tr__main-map-context-menu');
        if (!contextMenu) {
            return;
        }
        contextMenu.style.display = 'none';
        ReactDom.render(<React.Fragment></React.Fragment>, contextMenu);
    };

    render() {
        return (
            <section id="tr__main-map">
                <div id="tr__main-map-context-menu" className="tr__main-map-context-menu"></div>
                {this.props.children}
                <div id="maplibregl-map" ref={this.setRef} style={{ height: '100%', width: '100%' }}></div>
                {this.state.confirmModalDeleteIsOpen && (
                    <ConfirmModal
                        title={this.props.t('transit:transitNode:ConfirmMultipleDelete')}
                        confirmAction={this.onDeleteSelectedNodes}
                        isOpen={true}
                        confirmButtonColor="red"
                        confirmButtonLabel={this.props.t('transit:transitNode:MultipleDelete')}
                        closeModal={() => this.setState({ confirmModalDeleteIsOpen: false })}
                    />
                )}
            </section>
        );
    }
}

export default withTranslation(['transit', 'main'])(MainMap);
