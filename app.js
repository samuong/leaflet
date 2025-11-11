const App = {
    // App-level state (cross-cutting concerns)
    state: {
        currentScreen: 'OVERVIEW',
        debugMode: false,
        navigationActive: false
    },

    // Screen definitions and logic
    screens: {
        OVERVIEW: {
            elements: {},
            
            init() {
                this.elements = {
                    overviewScreen: document.getElementById('overview-screen'),
                    startButton: document.getElementById('startButton')
                };
            },
            
            show() {
                // Hide all screens
                document.querySelectorAll('.screen').forEach(screen => {
                    screen.classList.remove('active');
                });
                
                // Show overview screen
                this.elements.overviewScreen.classList.add('active');
                
                // Cleanup resources
                App.system.releaseWakeLock();
                App.map.dispose();
                App.gps.stop();
                App.state.navigationActive = false;
            }
        },
        
        MAP: {
            elements: {},
            
            init() {
                this.elements = {
                    mapScreen: document.getElementById('map-screen'),
                    nextTurnDiv: null, // Will be added later
                    positionDiv: null  // Will be added later
                };
            },
            
            show() {
                // Hide all screens
                document.querySelectorAll('.screen').forEach(screen => {
                    screen.classList.remove('active');
                });
                
                // Show map screen
                this.elements.mapScreen.classList.add('active');
                
                // Initialize resources
                App.map.init();
                App.gps.start();
                App.system.requestWakeLock();
                App.state.navigationActive = true;
            }
        },
        
        CUE_SHEET: {
            elements: {},
            
            init() {
                // Will be implemented when cue sheet is added
            },
            
            show() {
                // Will be implemented when cue sheet is added
            }
        },
        
        POSITION_BOARD: {
            elements: {},
            
            init() {
                // Will be implemented when position board is added
            },
            
            show() {
                // Will be implemented when position board is added
            }
        }
    },

    // Screen transitions
    transitions: {
        showOverview() {
            App.state.currentScreen = 'OVERVIEW';
            App.screens.OVERVIEW.show();
            history.pushState({ screen: 'OVERVIEW' }, '', '');
        },
        
        showMap() {
            App.state.currentScreen = 'MAP';
            App.screens.MAP.show();
            history.pushState({ screen: 'MAP' }, '', '#map');
        },
        
        showCueSheet() {
            App.state.currentScreen = 'CUE_SHEET';
            App.screens.CUE_SHEET.show();
            history.pushState({ screen: 'CUE_SHEET' }, '', '#cue-sheet');
        },
        
        showPositionBoard() {
            App.state.currentScreen = 'POSITION_BOARD';
            App.screens.POSITION_BOARD.show();
            history.pushState({ screen: 'POSITION_BOARD' }, '', '#position-board');
        }
    },

    // Geolocation functionality
    gps: {
        watchId: null,
        lastPosition: null,
        
        start() {
            if (navigator.geolocation) {
                this.watchId = navigator.geolocation.watchPosition(
                    (position) => {
                        const lat = position.coords.latitude;
                        const lng = position.coords.longitude;
                        const accuracy = position.coords.accuracy;
                        const latlng = [lat, lng];

                        this.lastPosition = { lat, lng, accuracy };
                        App.debug.log(`GPS: Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)}, Acc ${accuracy.toFixed(2)}m`);
                        App.map.updateUserPosition(latlng, accuracy);
                    },
                    (error) => {
                        App.debug.log(`Geolocation error: ${error.message}`);
                    },
                    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
                );
                App.debug.log('Started watching geolocation.');
            } else {
                App.debug.log('Geolocation not supported in this browser.');
            }
        },
        
        stop() {
            if (this.watchId !== null) {
                navigator.geolocation.clearWatch(this.watchId);
                this.watchId = null;
                App.debug.log('Stopped watching geolocation.');
            }
            App.map.clearUserMarkers();
        }
    },

    // Leaflet map management
    map: {
        instance: null,
        userMarker: null,
        accuracyCircle: null,
        routeLayer: null,
        
        init() {
            if (this.instance !== null) {
                this.instance.remove();
            }
            this.instance = L.map('map').fitWorld();

            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            }).addTo(this.instance);

            App.debug.log('Leaflet map initialized.');
            this.loadRoute();
            // GPS will be started by the MAP screen
        },

        async loadRoute() {
            try {
                const response = await fetch('route.json');
                const routeData = await response.json();
                
                // Convert GeoJSON coordinates to Leaflet format
                const coordinates = routeData.geometry.coordinates.map(coord => [coord[1], coord[0]]);
                
                // Create route polyline
                this.routeLayer = L.polyline(coordinates, {
                    color: 'blue',
                    weight: 4,
                    opacity: 0.7
                }).addTo(this.instance);
                
                // Fit map to route bounds
                this.instance.fitBounds(this.routeLayer.getBounds(), { padding: [50, 50] });
                
                App.debug.log('Route loaded and drawn on map.');
            } catch (error) {
                App.debug.log('Failed to load route: ' + error.message);
            }
        },
        
        dispose() {
            if (this.routeLayer) {
                this.instance.removeLayer(this.routeLayer);
                this.routeLayer = null;
            }
            if (this.instance !== null) {
                this.instance.remove();
                this.instance = null;
                App.debug.log('Leaflet map disposed.');
            }
        },
        
        updateUserPosition(latlng, accuracy) {
            if (this.userMarker) {
                this.userMarker.setLatLng(latlng);
            } else {
                this.userMarker = L.marker(latlng).addTo(this.instance);
            }

            if (this.accuracyCircle) {
                this.accuracyCircle.setLatLng(latlng).setRadius(accuracy);
            } else {
                this.accuracyCircle = L.circle(latlng, accuracy).addTo(this.instance);
            }
            this.instance.setView(latlng, this.instance.getZoom() < 15 ? 15 : this.instance.getZoom());
        },
        
        clearUserMarkers() {
            if (this.userMarker) {
                this.instance.removeLayer(this.userMarker);
                this.userMarker = null;
            }
            if (this.accuracyCircle) {
                this.instance.removeLayer(this.accuracyCircle);
                this.accuracyCircle = null;
            }
        }
    },

    // System-level functionality
    system: {
        wakeLock: null,
        
        async requestWakeLock() {
            if ('wakeLock' in navigator) {
                try {
                    this.wakeLock = await navigator.wakeLock.request('screen');
                    this.wakeLock.addEventListener('release', () => {
                        App.debug.log('Wake Lock was released');
                    });
                    App.debug.log('Wake Lock was acquired');
                } catch (err) {
                    if (err.name === 'NotAllowedError') {
                        App.debug.log(`Wake Lock request denied: ${err.message}. User gesture required or permission denied.`);
                    } else {
                        App.debug.log(`Wake Lock error: ${err.name}, ${err.message}`);
                    }
                }
            } else {
                App.debug.log('Wake Lock API not supported in this browser.');
            }
        },
        
        releaseWakeLock() {
            if (this.wakeLock) {
                this.wakeLock.release();
                this.wakeLock = null;
            }
        }
    },

    // Logging and debugging
    debug: {
        elements: {},
        
        init() {
            this.elements = {
                debugLog: document.getElementById('debug-log'),
                toggleDebugButton: document.getElementById('toggleDebugButton')
            };
        },
        
        logToScreen(message) {
            const p = document.createElement('p');
            p.textContent = new Date().toLocaleTimeString() + ': ' + message;
            this.elements.debugLog.appendChild(p);
            this.elements.debugLog.scrollTop = this.elements.debugLog.scrollHeight;
        },
        
        log(message) {
            if (App.state.debugMode) {
                this.logToScreen(message);
            }
            console.log(message);
        },
        
        updateDisplay() {
            const { debugLog, toggleDebugButton } = this.elements;
            if (App.state.debugMode) {
                debugLog.classList.add('active');
                toggleDebugButton.textContent = 'Disable Debugging';
            } else {
                debugLog.classList.remove('active');
                toggleDebugButton.textContent = 'Enable Debugging';
            }
        },
        
        toggleMode() {
            App.state.debugMode = !App.state.debugMode;
            localStorage.setItem('debugMode', App.state.debugMode);
            this.updateDisplay();
            this.log(`Debug mode ${App.state.debugMode ? 'enabled' : 'disabled'}`);
        }
    },

    // Event binding
    bindEvents() {
        const { startButton } = App.screens.OVERVIEW.elements;
        const { toggleDebugButton } = App.debug.elements;
        
        startButton.addEventListener('click', () => {
            App.transitions.showMap();
        });

        toggleDebugButton.addEventListener('click', () => {
            App.debug.toggleMode();
        });

        window.addEventListener('popstate', (event) => {
            const targetScreen = event.state && event.state.screen ? event.state.screen : 'OVERVIEW';
            
            // Use transitions to ensure proper state management
            switch (targetScreen) {
                case 'OVERVIEW':
                    App.transitions.showOverview();
                    break;
                case 'MAP':
                    App.transitions.showMap();
                    break;
                case 'CUE_SHEET':
                    App.transitions.showCueSheet();
                    break;
                case 'POSITION_BOARD':
                    App.transitions.showPositionBoard();
                    break;
                default:
                    App.transitions.showOverview();
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (App.system.wakeLock !== null && document.visibilityState === 'visible' && App.state.navigationActive) {
                App.debug.log('Visibility changed to visible while navigation is active, re-requesting Wake Lock.');
                App.system.requestWakeLock();
            } else if (document.visibilityState === 'hidden' && App.system.wakeLock) {
                App.debug.log('Page hidden, Wake Lock likely released by browser.');
            }
        });
    },

    // Main initialization
    init() {
        // Clear any URL fragment on page load
        if (window.location.hash) {
            history.replaceState({}, '', window.location.pathname);
        }
        
        // Initialize app state
        App.state.debugMode = localStorage.getItem('debugMode') === 'true';
        
        // Initialize debug elements
        App.debug.init();
        
        // Initialize all screens
        Object.values(App.screens).forEach(screen => screen.init());
        
        // Setup event listeners
        App.bindEvents();
        
        // Show initial screen
        App.transitions.showOverview();
    }
};

// Start the application
document.addEventListener('DOMContentLoaded', () => App.init());