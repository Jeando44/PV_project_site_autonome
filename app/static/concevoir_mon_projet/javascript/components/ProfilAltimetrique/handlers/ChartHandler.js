import { CHART_CONFIG, DRAWING_STYLES, CHART_COLORS, ELEVATION_PROVIDERS } from '../constants.js';

/**
 * Gestionnaire du graphique Google Charts
 * @class ChartHandler
 */
class ChartHandler {
  /**
   * @param {HTMLElement} container - Conteneur du graphique
   * @param {google.maps.Map} map - Instance de la carte
   */
  constructor(container, map = null) {
    this.container = container;
    this.chart = null;
    this.isGoogleChartsLoaded = false;
    this.loadPromise = null;
    this.map = map;
    this.hoverInfoWindow = null;
    this.currentProfileData = null;
    
    // Écouter les événements de survol de la polyline
    this._setupPolylineHoverListeners();
  }

  /**
   * Charge la bibliothèque Google Charts
   * @returns {Promise<void>}
   */
  async loadGoogleCharts() {
    if (this.isGoogleChartsLoaded) {
      return Promise.resolve();
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = new Promise((resolve, reject) => {
      if (window.google && window.google.charts) {
        google.charts.load('current', { packages: ['corechart'] });
        google.charts.setOnLoadCallback(() => {
          this.isGoogleChartsLoaded = true;
          resolve();
        });
      } else {
        const script = document.createElement('script');
        script.src = 'https://www.gstatic.com/charts/loader.js';
        script.async = true;
        
        script.onload = () => {
          google.charts.load('current', { packages: ['corechart'] });
          google.charts.setOnLoadCallback(() => {
            this.isGoogleChartsLoaded = true;
            resolve();
          });
        };

        script.onerror = () => {
          reject(new Error('Erreur lors du chargement de Google Charts'));
        };

        document.head.appendChild(script);
      }
    });

    return this.loadPromise;
  }

  /**
   * Dessine le graphique avec les données du profil
   * @param {Object} profileData - Données formatées du profil
   * @returns {Promise<void>}
   */
  async drawChart(profileData) {
    await this.loadGoogleCharts();

    const { points } = profileData;
    this.currentProfileData = profileData;
    
    // Déterminer la couleur selon le provider
    const provider = profileData.provider || ELEVATION_PROVIDERS.GEOPORTAIL;
    const lineColor = CHART_COLORS[provider] || CHART_COLORS[ELEVATION_PROVIDERS.GEOPORTAIL];

    const data = new google.visualization.DataTable();
    data.addColumn('number', CHART_CONFIG.X_AXIS_LABEL);
    data.addColumn('number', CHART_CONFIG.Y_AXIS_LABEL);
    data.addColumn({ type: 'string', role: 'tooltip', p: { html: true } });

    const rows = points.map(point => [
      point.distance,
      point.altitude,
      this._createTooltip(point)
    ]);
    data.addRows(rows);

    const altitudeScale = this._calculateAltitudeScale(points);

    const createOptions = (containerWidth, containerHeight) => ({
      title: CHART_CONFIG.TITLE,
      hAxis: {
        title: CHART_CONFIG.X_AXIS_LABEL,
        format: '#,### m',
        gridlines: { color: '#e0e0e0' },
        minorGridlines: { color: '#f5f5f5' }
      },
      vAxis: {
        title: CHART_CONFIG.Y_AXIS_LABEL,
        format: altitudeScale.format,
        ...(altitudeScale.ticks ? { 
          ticks: altitudeScale.ticks,
          gridlines: { 
            color: '#e0e0e0'
          }
        } : {
          gridlines: { 
            color: '#e0e0e0',
            count: altitudeScale.gridlineCount
          }
        }),
        minorGridlines: { 
          color: '#f5f5f5',
          count: altitudeScale.minorGridlineCount
        },
        viewWindow: {
          min: altitudeScale.min,
          max: altitudeScale.max
        },
        textStyle: {
          fontSize: 12,
          color: '#333',
          fontName: 'Arial'
        },
        titleTextStyle: {
          fontSize: 13,
          italic: true,
          color: '#333',
        },
        baseline: altitudeScale.min,
        baselineColor: '#333'
      },
      legend: { position: 'none' },
      colors: [lineColor],
      curveType: CHART_CONFIG.CURVE_TYPE,
      lineWidth: 3,
      pointSize: 0,
      areaOpacity: CHART_CONFIG.AREA_OPACITY,
      chartArea: {
        left: 90,
        top: 60,
        right: 40,
        bottom: 80
      },
      width: containerWidth,
      height: containerHeight,
      backgroundColor: 'white',
      tooltip: {
        isHtml: false,
        trigger: 'both'
      }
    });

    const checkAndDraw = () => {
      const width = this.container.offsetWidth;
      const height = this.container.offsetHeight;
      
      if (width > 0 && height > 0) {
        const options = createOptions(width, height);
        
        if (!this.chart) {
          this.chart = new google.visualization.AreaChart(this.container);
          this._setupChartInteractions();
        }
        
        this.chart.draw(data, options);
      } else {
        setTimeout(checkAndDraw, 100);
      }
    };
    
    checkAndDraw();
  }

  /**
   * Met à jour le graphique avec de nouvelles données
   * @param {Object} profileData - Nouvelles données
   * @returns {Promise<void>}
   */
  async updateChart(profileData) {
    return this.drawChart(profileData);
  }

  /**
   * Efface le graphique
   */
  clearChart() {
    this._hideHoverTooltip();
    this._hideChartTooltip();
    
    if (this.chart) {
      this.chart.clearChart();
    }
    
    this.container.innerHTML = '';
    this.currentProfileData = null;
  }

  /**
   * Calcule l'échelle adaptative pour l'axe Y (altitude)
   * @private
   * @param {Array} points - Points du profil
   * @returns {Object} Configuration de l'échelle
   */
  _calculateAltitudeScale(points) {
    const altitudes = points.map(p => p.altitude);
    const minAlt = Math.min(...altitudes);
    const maxAlt = Math.max(...altitudes);
    const range = maxAlt - minAlt;

    let margin;
    if (range <= 2) {
      margin = 0.5;
    } else if (range <= 10) {
      margin = Math.max(range * 0.15, 1);
    } else {
      margin = Math.max(range * 0.1, 2);
    }
    
    let min = minAlt - margin;
    let max = maxAlt + margin;
    min = Math.max(0, min);

    const totalRange = max - min;
    let format, gridlineCount, minorGridlineCount, ticks;

    if (totalRange <= 1) {
      format = '#.## m';
      min = Math.floor(min * 10) / 10;
      max = Math.ceil(max * 10) / 10;
      
      ticks = [];
      for (let val = min; val <= max; val += 0.1) {
        ticks.push(Number(val.toFixed(2)));
      }
      gridlineCount = -1;
      minorGridlineCount = 4;
      
    } else if (totalRange <= 3) {
      format = '#.## m';
      min = Math.floor(min * 4) / 4;
      max = Math.ceil(max * 4) / 4;
      
      ticks = [];
      for (let val = min; val <= max; val += 0.25) {
        ticks.push(Number(val.toFixed(2)));
      }
      gridlineCount = -1;
      minorGridlineCount = 4;
      
    } else if (totalRange <= 6) {
      format = '#.## m';
      min = Math.floor(min * 2) / 2;
      max = Math.ceil(max * 2) / 2;
      
      ticks = [];
      for (let val = min; val <= max; val += 0.5) {
        ticks.push(Number(val.toFixed(2)));
      }
      gridlineCount = -1;
      minorGridlineCount = 4;
      
    } else if (totalRange <= 12) {
      format = '#.# m';
      min = Math.floor(min);
      max = Math.ceil(max);
      
      ticks = [];
      for (let val = min; val <= max; val += 1) {
        ticks.push(val);
      }
      gridlineCount = -1;
      minorGridlineCount = 4;
      
    } else if (totalRange <= 25) {
      format = '# m';
      min = Math.floor(min);
      max = Math.ceil(max);
      
      ticks = [];
      for (let val = min; val <= max; val += 2) {
        ticks.push(val);
      }
      gridlineCount = -1;
      minorGridlineCount = 3;
      
    } else if (totalRange <= 50) {
      format = '# m';
      min = Math.floor(min / 5) * 5;
      max = Math.ceil(max / 5) * 5;
      
      gridlineCount = Math.ceil((max - min) / 5) + 1;
      minorGridlineCount = 4;
      
    } else if (totalRange <= 200) {
      format = '# m';
      min = Math.floor(min / 20) * 20;
      max = Math.ceil(max / 20) * 20;
      
      gridlineCount = Math.ceil((max - min) / 20) + 1;
      minorGridlineCount = 3;
      
    } else {
      format = '# m';
      min = Math.floor(min / 50) * 50;
      max = Math.ceil(max / 50) * 50;
      
      gridlineCount = Math.ceil((max - min) / 50) + 1;
      minorGridlineCount = 4;
    }

    const result = {
      min,
      max,
      format,
      gridlineCount,
      minorGridlineCount,
      range: max - min,
      dataMin: minAlt,
      dataMax: maxAlt
    };
    
    if (ticks) {
      result.ticks = ticks;
    }

    return result;
  }

  /**
   * Crée le HTML du tooltip pour un point
   * @private
   * @param {Object} point - Point de données
   * @returns {string} HTML du tooltip
   */
  _createTooltip(point) {
    return `Distance: ${point.distance.toFixed(2)} m\n` +
    `Altitude: ${point.altitude.toFixed(2)} m\n` +
    `Pente: ${point.slope.toFixed(2)}%`;
  }

  /**
   * Configure les listeners pour les événements de survol de la polyline
   * @private
   */
  _setupPolylineHoverListeners() {
    // Événement quand on survole la polyline sur la carte
    this.polylineHoverListener = document.addEventListener('profil:polyline:hover', (event) => {
      if (this.currentProfileData && event.detail) {
        const { segmentIndex, point } = event.detail;
        
        // Trouver le point correspondant dans les données du graphique
        // On utilise l'index du segment + 1 pour avoir le point de fin
        const pointIndex = Math.min(segmentIndex + 1, this.currentProfileData.points.length - 1);
        const chartPoint = this.currentProfileData.points[pointIndex];
        
        if (chartPoint) {
          this._showChartTooltip(chartPoint, pointIndex);
        }
      }
    });

    // Événement quand on quitte la polyline
    this.polylineHoveroutListener = document.addEventListener('profil:polyline:hoverout', () => {
      this._hideChartTooltip();
    });
  }

  /**
   * Configure les interactions du graphique (survol)
   * @private
   */
  _setupChartInteractions() {
    if (!this.map || !this.chart) return;

    google.visualization.events.addListener(this.chart, 'onmouseover', (event) => {
      if (event.row !== null && this.currentProfileData) {
        const point = this.currentProfileData.points[event.row];
        if (point) {
          this._showHoverTooltip(point);
        }
      }
    });

    google.visualization.events.addListener(this.chart, 'onmouseout', () => {
      this._hideHoverTooltip();
    });
  }

  /**
   * Affiche le tooltip de survol sur la carte
   * @private
   * @param {Object} point - Point du profil
   */
  _showHoverTooltip(point) {
    if (!this.map) return;

    const position = new google.maps.LatLng(point.lat, point.lon);

    // Créer l'InfoWindow si elle n'existe pas
    if (!this.hoverInfoWindow) {
      this.hoverInfoWindow = new google.maps.InfoWindow({
        disableAutoPan: true,
        pixelOffset: new google.maps.Size(0, -10)
      });
    }

    // Créer le contenu du tooltip avec le même format que TooltipHandler
    const content = this._createTooltipContentHtml(point);
    
    this.hoverInfoWindow.setContent(content);
    this.hoverInfoWindow.setPosition(position);
    this.hoverInfoWindow.open(this.map);
  }

  /**
   * Masque le tooltip de survol
   * @private
   */
  _hideHoverTooltip() {
    if (this.hoverInfoWindow) {
      this.hoverInfoWindow.close();
    }
  }

  /**
   * Crée le contenu HTML du tooltip
   * @private
   * @param {Object} point - Point du profil
   * @returns {string} Contenu HTML
   */
  _createTooltipContentHtml(point) {
    const { altitude, distance, slope } = point;
    const profilName = this.currentProfileData?.name || 'Profil Altimétrique';
    
    return `
      <div style="
        padding: 8px;
        font-family: Arial, sans-serif;
        font-size: 12px;
        line-height: 1.6;
        min-width: 150px;
      ">
        <span style="font-weight: bold; color: #333;">${profilName}</span>
            <div style="display: flex; justify-content: space-between; margin: 4px 0;">
          <span style="color: #666;">Distance:</span>
          <span style="font-weight: bold; color: #333;">${distance.toFixed(2)} m</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin: 4px 0;">
          <span style="color: #666;">Altitude:</span>
          <span style="font-weight: bold; color: #333;">${altitude.toFixed(2)} m</span>
        </div>
    
        <div style="display: flex; justify-content: space-between; margin: 4px 0;">
          <span style="color: #666;">Pente:</span>
          <span style="font-weight: bold; color: ${this._getSlopeColor(slope)};">${slope.toFixed(2)}%</span>
        </div>
      </div>
    `;
  }

  /**
   * Retourne une couleur en fonction de la pente
   * @private
   * @param {number} slope - Pente en pourcentage
   * @returns {string} Couleur CSS
   */
  _getSlopeColor(slope) {
    const absSlope = Math.abs(slope);
    
    if (absSlope < 5) return '#4CAF50'; // Vert pour pente faible
    if (absSlope < 10) return '#FF9800'; // Orange pour pente moyenne
    return '#f44336'; // Rouge pour pente forte
  }

  /**
   * Affiche un tooltip sur le graphique à la position du point
   * en utilisant le système de sélection natif de Google Charts
   * @private
   * @param {Object} point - Point du profil
   * @param {number} pointIndex - Index du point dans les données
   */
  _showChartTooltip(point, pointIndex) {
    if (!this.chart) return;

    // Utiliser setSelection pour afficher le tooltip natif de Google Charts
    this.chart.setSelection([{
      row: pointIndex,
      column: 1
    }]);
  }

  /**
   * Masque le tooltip sur le graphique
   * en désélectionnant tous les points
   * @private
   */
  _hideChartTooltip() {
    if (this.chart) {
      this.chart.setSelection([]);
    }
  }

  /**
   * Nettoie les ressources
   */
  destroy() {
    if (this.hoverInfoWindow) {
      this.hoverInfoWindow.close();
      this.hoverInfoWindow = null;
    }
    
    // Retirer les listeners d'événements
    if (this.polylineHoverListener) {
      document.removeEventListener('profil:polyline:hover', this.polylineHoverListener);
    }
    if (this.polylineHoveroutListener) {
      document.removeEventListener('profil:polyline:hoverout', this.polylineHoveroutListener);
    }
    
    this.currentProfileData = null;
  }

  /**
   * Redimensionne le graphique
   */
  resize() {
    if (this.chart) {
      this.chart.draw(this.chart.getDataTable(), this.chart.getOptions());
    }
  }
}

export default ChartHandler;

