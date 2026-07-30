/**
 * RADAR MÉTÉO DIRECT - MAPLIBRE GL JS APPLICATION
 * Visualisation haute performance et responsive des précipitations
 */

(function () {
  'use strict';

  // --- CONFIGURATION GLOBAL ---
  const RADAR_BASE_URL = 'https://radar-images.19374629.xyz/';
  // Fallback radar bounds
  const RADAR_BOUNDS = [
    [-5.50, 51.50], // haut-gauche [lon, lat]
    [ 9.80, 51.50], // haut-droite
    [ 9.80, 41.30], // bas-droite
    [-5.50, 41.30]  // bas-gauche
  ];

  const FRAME_COUNT = 12; // 12 trames (1h de recul)
  const FRAME_INTERVAL_MS = 1000; // 1 seconde par trame par défaut

  // MapLibre Base Style avec calques sombre et clair combinés
  const MAP_STYLE = {
    version: 8,
    sources: {
      'carto-dark': {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
        tileSize: 256,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>'
      },
      'carto-light': {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'],
        tileSize: 256,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>'
      }
    },
    layers: [
      {
        id: 'carto-dark-layer',
        type: 'raster',
        source: 'carto-dark',
        minzoom: 0,
        maxzoom: 20,
        layout: { visibility: 'visible' }
      },
      {
        id: 'carto-light-layer',
        type: 'raster',
        source: 'carto-light',
        minzoom: 0,
        maxzoom: 20,
        layout: { visibility: 'none' }
      }
    ]
  };

  // --- STATE ---
  let map = null;
  let frames = [];
  let currentIndex = 0;
  let isPlaying = false;
  let playTimer = null;
  let playbackSpeed = 1;
  let currentTheme = 'dark';
  let isMapLoaded = false;

  // --- DOM ELEMENTS ---
  const elTimelineSlider = document.getElementById('timelineSlider');
  const elPlayBtn = document.getElementById('playBtn');
  const elPlayIcon = document.getElementById('playIcon');
  const elPauseIcon = document.getElementById('pauseIcon');
  const elPrevBtn = document.getElementById('prevBtn');
  const elNextBtn = document.getElementById('nextBtn');
  const elRefreshBtn = document.getElementById('refreshBtn');
  const elTimeClock = document.getElementById('timeClock');
  const elTimeRelative = document.getElementById('timeRelative');
  const elLoadingOverlay = document.getElementById('loadingOverlay');
  const elLoadingStatus = document.getElementById('loadingStatusText');
  const elThemeToggleBtn = document.getElementById('themeToggleBtn');
  const elLocateBtn = document.getElementById('locateBtn');
  const elLegendPanel = document.getElementById('legendPanel');
  const elLegendToggleBtn = document.getElementById('legendToggleBtn');
  const speedButtons = document.querySelectorAll('.speed-btn');

  // --- INITIALIZATION ---
  window.addEventListener('DOMContentLoaded', () => {
    initMap();
    initEventListeners();
    loadRadarData();
  });

  // --- MAPLIBRE SETUP ---
  function initMap() {
    map = new maplibregl.Map({
      container: 'map',
      style: MAP_STYLE,
      center: [2.2137, 46.5276], // Centre de la France
      zoom: 5.5,
      minZoom: 3,
      maxZoom: 14,
      pitch: 0,
      minPitch: 0,
      maxPitch: 0,
      bearing: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', () => {
      isMapLoaded = true;
      setupRadarLayer();
      setupRadarBoundsBox();
      checkInitComplete();
    });
  }

  function updateLoadingStatus(msg) {
    if (elLoadingStatus) {
      elLoadingStatus.textContent = msg;
    }
  }

  function setupRadarLayer() {
    if (!map.getSource('radar-source')) {
      // PNG 1x1 transparent valide pour le décodeur WebGL de MapLibre GL JS
      const transparentPNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      
      map.addSource('radar-source', {
        type: 'image',
        url: transparentPNG,
        coordinates: RADAR_BOUNDS
      });

      map.addLayer({
        id: 'radar-layer',
        type: 'raster',
        source: 'radar-source',
        paint: {
          'raster-opacity': 0.8,
          'raster-resampling': 'nearest' // Garde le rendu pixelisé ultra-net des données radar
        }
      });
    }
  }

  function setupRadarBoundsBox() {
    const west = RADAR_BOUNDS[0][0];
    const north = RADAR_BOUNDS[0][1];
    const east = RADAR_BOUNDS[1][0];
    const south = RADAR_BOUNDS[2][1];

    const holeRing = [
      [west, north],
      [west, south],
      [east, south],
      [east, north],
      [west, north]
    ];

    const boxRing = [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
      [west, north]
    ];

    // 1. Masque d'assombrissement hors-zone (Monde entier - Rectangle dynamique)
    if (map.getSource('radar-outside-mask')) {
      map.getSource('radar-outside-mask').setData({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [[-180, 90], [180, 90], [180, -90], [-180, -90], [-180, 90]],
            holeRing
          ]
        }
      });
    } else {
      map.addSource('radar-outside-mask', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [[-180, 90], [180, 90], [180, -90], [-180, -90], [-180, 90]],
              holeRing
            ]
          }
        }
      });

      map.addLayer({
        id: 'radar-outside-mask-layer',
        type: 'fill',
        source: 'radar-outside-mask',
        paint: {
          'fill-color': '#030712',
          'fill-opacity': 0.439 // 140/255 * 0.8 raster-opacity = 0.439 pour une couleur 100% identique
        }
      });
    }

    // 2. Contour en pointillés dynamiques pour délimiter nettement la zone
    if (map.getSource('radar-bounds-box')) {
      map.getSource('radar-bounds-box').setData({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [boxRing]
        }
      });
    } else {
      map.addSource('radar-bounds-box', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [boxRing]
          }
        }
      });

      map.addLayer({
        id: 'radar-bounds-line',
        type: 'line',
        source: 'radar-bounds-box',
        paint: {
          'line-color': '#38bdf8',
          'line-width': 2,
          'line-dasharray': [4, 4],
          'line-opacity': 0.9
        }
      });
    }
  }

  // --- RADAR DATA LOADING & PRELOADING ---
  async function fetchMetadataBounds() {
    try {
      const res = await fetch(RADAR_BASE_URL + 'metadata.bin');
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength >= 32) {
          const view = new DataView(buffer);
          const north = view.getFloat64(0, true);  // Little-Endian double
          const south = view.getFloat64(8, true);
          const west  = view.getFloat64(16, true);
          const east  = view.getFloat64(24, true);

          RADAR_BOUNDS[0] = [west, north];
          RADAR_BOUNDS[1] = [east, north];
          RADAR_BOUNDS[2] = [east, south];
          RADAR_BOUNDS[3] = [west, south];
          return true;
        }
      }
    } catch (err) {
      console.warn('Metadata bin fallback aux limites par défaut:', err);
    }
    return false;
  }

  async function loadRadarData() {
    updateLoadingStatus('Recherche des images radar en parallèle...');
    
    // Récupération dynamique des limites binaire du serveur
    await fetchMetadataBounds();

    // Génération des candidats d'horodatages (du plus récent au plus ancien pour un affichage immédiat)
    const candidateFiles = getRadarFileCandidates(8); // 8 trames comme sur l'app Android
    const candidateFilesReversed = [...candidateFiles].reverse(); // Du plus récent au plus ancien

    let firstFrameLoaded = false;
    const validFramesMap = new Map();

    // Lancement de tous les téléchargements en parallèle (Promise.all)
    const loadPromises = candidateFilesReversed.map(async (file) => {
      const isValid = await testAndPreloadImage(file.url);
      if (isValid) {
        validFramesMap.set(file.url, file);

        // Dès que la trame la plus récente est disponible, on l'affiche immédiatement !
        if (!firstFrameLoaded) {
          firstFrameLoaded = true;
          frames = [file];
          currentIndex = 0;
          elTimelineSlider.max = 0;
          elTimelineSlider.value = 0;
          displayFrame(0);
          checkInitComplete();
        }
      }
    });

    // Attendre la fin du chargement parallèle complet en arrière-plan
    await Promise.all(loadPromises);

    // Reconstituer la liste complète des trames valides dans l'ordre chronologique
    const allValid = candidateFiles.filter(f => validFramesMap.has(f.url));
    if (allValid.length > 0) {
      frames = allValid;
      currentIndex = frames.length - 1;

      elTimelineSlider.max = frames.length - 1;
      elTimelineSlider.value = currentIndex;

      renderSliderTicks();
      displayFrame(currentIndex);
      checkInitComplete();
    } else if (!firstFrameLoaded) {
      updateLoadingStatus('Erreur : Aucune donnée radar disponible pour le moment.');
      setTimeout(() => {
        elLoadingOverlay.classList.add('hidden');
      }, 2000);
    }
  }

  function checkInitComplete() {
    if (isMapLoaded && frames.length > 0) {
      displayFrame(currentIndex);
      elLoadingOverlay.classList.add('hidden');
    }
  }

  /**
   * Calcul des URLs des candidats basé sur l'heure UTC actuelle - 5 minutes, arrondi à 5 minutes
   */
  function getRadarFileCandidates(count = 12) {
    const candidates = [];
    const now = new Date();
    
    // Décalage de 5 mn et arrondi à la tranche de 5 mn inférieure
    let time = new Date(now.getTime() - 5 * 60 * 1000);
    const minutes = Math.floor(time.getUTCMinutes() / 5) * 5;
    time.setUTCMinutes(minutes, 0, 0);

    for (let i = 0; i < count; i++) {
      const frameTime = new Date(time.getTime() - i * 5 * 60 * 1000);
      
      const year = frameTime.getUTCFullYear();
      const month = String(frameTime.getUTCMonth() + 1).padStart(2, '0');
      const day = String(frameTime.getUTCDate()).padStart(2, '0');
      const hours = String(frameTime.getUTCHours()).padStart(2, '0');
      const mins = String(frameTime.getUTCMinutes()).padStart(2, '0');

      const filename = `radar_${year}${month}${day}${hours}${mins}00.webp`;
      const url = RADAR_BASE_URL + filename;

      // Calcul heure locale pour affichage UI
      const localHours = String(frameTime.getHours()).padStart(2, '0');
      const localMins = String(frameTime.getMinutes()).padStart(2, '0');
      const timeStr = `${localHours}:${localMins}`;

      // Temps relatif
      const diffMins = Math.round((now.getTime() - frameTime.getTime()) / (60 * 1000));
      const relativeStr = diffMins === 0 ? "À l'instant" : `Il y a ${diffMins} min`;

      candidates.push({
        url,
        timestamp: frameTime.getTime(),
        timeStr,
        relativeStr
      });
    }

    return candidates.reverse(); // Ordre chronologique croissant
  }

  function testAndPreloadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  // --- DISPLAY & ANIMATION ---
  function displayFrame(index) {
    if (!frames || frames.length === 0 || !frames[index]) return;

    const frame = frames[index];

    // Mise à jour de l'image de calque MapLibre
    if (map && isMapLoaded && map.getSource('radar-source')) {
      try {
        const source = map.getSource('radar-source');
        source.updateImage({
          url: frame.url,
          coordinates: RADAR_BOUNDS
        });
      } catch (err) {
        console.warn('Radar image update deferred:', err);
      }
    }

    // Mise à jour de l'UI
    if (elTimeClock) elTimeClock.textContent = frame.timeStr;
    if (elTimeRelative) elTimeRelative.textContent = frame.relativeStr;
    if (elTimelineSlider) elTimelineSlider.value = index;
  }

  function play() {
    if (isPlaying) return;
    isPlaying = true;
    elPlayIcon.classList.add('hidden');
    elPauseIcon.classList.remove('hidden');

    const stepDuration = FRAME_INTERVAL_MS / playbackSpeed;
    playTimer = setInterval(() => {
      currentIndex = (currentIndex + 1) % frames.length;
      displayFrame(currentIndex);
    }, stepDuration);
  }

  function pause() {
    if (!isPlaying) return;
    isPlaying = false;
    elPlayIcon.classList.remove('hidden');
    elPauseIcon.classList.add('hidden');
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
  }

  function togglePlay() {
    if (isPlaying) pause();
    else play();
  }

  // --- UI EVENT LISTENERS ---
  function initEventListeners() {
    elPlayBtn.addEventListener('click', togglePlay);

    elPrevBtn.addEventListener('click', () => {
      pause();
      currentIndex = (currentIndex - 1 + frames.length) % frames.length;
      displayFrame(currentIndex);
    });

    elNextBtn.addEventListener('click', () => {
      pause();
      currentIndex = (currentIndex + 1) % frames.length;
      displayFrame(currentIndex);
    });

    elTimelineSlider.addEventListener('input', (e) => {
      pause();
      currentIndex = parseInt(e.target.value, 10);
      displayFrame(currentIndex);
    });

    elRefreshBtn.addEventListener('click', () => {
      pause();
      elLoadingOverlay.classList.remove('hidden');
      loadRadarData();
    });

    // Speed Selector Buttons
    speedButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        speedButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        playbackSpeed = parseFloat(btn.dataset.speed);
        if (isPlaying) {
          pause();
          play();
        }
      });
    });

    // Theme Toggle (Dark / Light)
    elThemeToggleBtn.addEventListener('click', () => {
      currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.body.classList.toggle('light-theme', currentTheme === 'light');
      
      if (map && isMapLoaded) {
        const isDark = currentTheme === 'dark';
        map.setLayoutProperty('carto-dark-layer', 'visibility', isDark ? 'visible' : 'none');
        map.setLayoutProperty('carto-light-layer', 'visibility', isDark ? 'none' : 'visible');

        // Le masque extérieur conserve la même couleur #030712 et l'opacité 0.439 que l'image du serveur
        if (map.getLayer('radar-outside-mask-layer')) {
          map.setPaintProperty('radar-outside-mask-layer', 'fill-color', '#030712');
          map.setPaintProperty('radar-outside-mask-layer', 'fill-opacity', 0.439);
        }
      }
    });

    // Legend Toggle Collapsible
    elLegendToggleBtn.addEventListener('click', () => {
      elLegendPanel.classList.toggle('collapsed');
    });

    // Geolocate User
    elLocateBtn.addEventListener('click', () => {
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { longitude, latitude } = pos.coords;
            map.flyTo({ center: [longitude, latitude], zoom: 8 });

            new maplibregl.Marker({ color: '#38bdf8' })
              .setLngLat([longitude, latitude])
              .addTo(map);
          },
          (err) => {
            alert('Impossible de récupérer votre position : ' + err.message);
          }
        );
      } else {
        alert('La géolocalisation n’est pas supportée par votre navigateur.');
      }
    });
  }

  function renderSliderTicks() {
    const ticksContainer = document.getElementById('sliderTicks');
    if (!ticksContainer) return;
    ticksContainer.innerHTML = '';

    frames.forEach((f, idx) => {
      const dot = document.createElement('div');
      dot.className = 'tick-dot';
      ticksContainer.appendChild(dot);
    });
  }

})();
