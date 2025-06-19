class MultiDotViewer {
  constructor() {
    this.diagrams = new Map();
    this.currentScale = 1;
    this.currentTransform = { x: 0, y: 0 };
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.activeDiagram = null;
    this.nextDiagramPosition = { x: 50, y: 50 };
    this.diagramSpacing = 450;
    this.hasSampleDiagrams = false;
    this.sidebarWidth = 280;
    this.isResizing = false;
    this.currentRowMaxHeight = 0;
    this.currentRowStartY = 50;
    this.connections = new Map(); // Store diagram connections
    this.draggedDiagram = null;
    this.dragOffset = { x: 0, y: 0 };
    this.isDraggingDiagram = false;
    this.connectionVisibility = 'all'; // 'all', 'subset', or 'none'
    this.hideTransitive = false; // Toggle for hiding transitive connections
    this.minSharedLabels = 0; // Minimum shared labels to show connections
    this.selectedDiagramId = null; // Currently active diagram (for highlighting)
    this.visibleDiagrams = new Set(); // Set of diagram IDs visible (always active now)

    // Performance caching for connections
    this.connectionCache = new Map(); // Cache for diagram pair relationships
    this.labelSetCache = new Map(); // Cache for label Sets to avoid recreation
    this.allConnections = []; // Cache for all possible connections
    this.connectionsCacheValid = false; // Flag to track if cache needs refresh

    this.initializeElements();
    this.initializeEventListeners();
    this.initializeCanvas();
    this.initializeSidebarResize();
    this.loadSampleDiagrams();
  }

  initializeElements() {
    this.svg = d3.select('#mainSvg');
    this.viewport = d3.select('#viewport');
    this.fileInput = document.getElementById('fileInput');
    this.loadFilesBtn = document.getElementById('loadFiles');
    this.resetViewBtn = document.getElementById('resetView');
    this.fitAllBtn = document.getElementById('fitAll');
    this.zoomInBtn = document.getElementById('zoomIn');
    this.zoomOutBtn = document.getElementById('zoomOut');
    this.zoomLevel = document.getElementById('zoomLevel');
    this.connectionVisibilitySelect = document.getElementById('connectionVisibility');
    this.hideTransitiveBtn = document.getElementById('hideTransitive');
    this.minSharedLabelsInput = document.getElementById('minSharedLabels');
    this.selectAllBtn = document.getElementById('selectAll');
    this.unselectAllBtn = document.getElementById('unselectAll');
    this.diagramList = document.getElementById('diagramList');
    this.diagramCount = document.getElementById('diagramCount');
    this.loadingIndicator = document.getElementById('loadingIndicator');
    this.sidebarResizer = document.getElementById('sidebarResizer');
    this.appContainer = document.querySelector('.app-container');
  }

  initializeEventListeners() {
    // File loading
    this.loadFilesBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', (e) => this.handleFileLoad(e));

    // View controls
    this.resetViewBtn.addEventListener('click', () => this.resetView());
    this.fitAllBtn.addEventListener('click', () => this.fitAllDiagrams());
    this.zoomInBtn.addEventListener('click', () => this.zoomIn());
    this.zoomOutBtn.addEventListener('click', () => this.zoomOut());
    this.connectionVisibilitySelect.addEventListener('change', (e) => this.updateConnectionVisibility(e));
    this.hideTransitiveBtn.addEventListener('click', () => this.toggleTransitiveConnections());
    this.minSharedLabelsInput.addEventListener('input', (e) => this.updateMinSharedLabels(e));
    this.selectAllBtn.addEventListener('click', () => this.selectAllDiagrams());
    this.unselectAllBtn.addEventListener('click', () => this.unselectAllDiagrams());

    // Canvas interactions
    this.svg.on('mousedown', (event) => this.handleMouseDown(event));
    this.svg.on('mousemove', (event) => this.handleMouseMove(event));
    this.svg.on('mouseup', () => this.handleMouseUp());
    this.svg.on('wheel', (event) => this.handleWheel(event));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyDown(e));

    // Prevent context menu on canvas
    this.svg.node().addEventListener('contextmenu', (e) => e.preventDefault());
  }

  initializeCanvas() {
    // Set up zoom behavior
    this.zoom = d3.zoom()
      .scaleExtent([0.1, 10])
      .on('zoom', (event) => {
        this.currentScale = event.transform.k;
        this.currentTransform = { x: event.transform.x, y: event.transform.y };
        this.viewport.attr('transform', event.transform);
        this.updateZoomLevel();
      });

    this.svg.call(this.zoom);
    this.updateZoomLevel();

    // Create arrowhead marker for subset arrows
    this.createArrowheadMarker();
  }

  createArrowheadMarker() {
    const defs = this.svg.select('defs').empty() ? this.svg.append('defs') : this.svg.select('defs');

    if (defs.select('#arrowhead').empty()) {
      const marker = defs.append('marker')
        .attr('id', 'arrowhead')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 8)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto');

      marker.append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', '#ef4444')
        .attr('stroke', '#ef4444')
        .attr('stroke-width', 1);
    }
  }

  async loadSampleDiagrams() {
    const sampleData = JSON.parse(document.getElementById('sampleDots').textContent);
    await this.processDotFiles(sampleData);
    this.hasSampleDiagrams = true;
  }

  async handleFileLoad(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    this.showLoading(true);

    try {
      // Only clear sample diagrams on first upload, not subsequent uploads
      if (this.hasSampleDiagrams) {
        this.clearAllDiagrams();
        this.hasSampleDiagrams = false;
      }

      const dotFiles = {};

      for (const file of files) {
        const content = await this.readFileContent(file);
        dotFiles[file.name] = content;
      }

      await this.processDotFiles(dotFiles);
    } catch (error) {
      console.error('Error loading files:', error);
      this.showError('Error loading DOT files. Please check the file format.');
    } finally {
      this.showLoading(false);
    }
  }

  readFileContent(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  }

  async processDotFiles(dotFiles) {
    let successCount = 0;
    let duplicateCount = 0;
    let totalFiles = Object.keys(dotFiles).length;

    for (const [filename, content] of Object.entries(dotFiles)) {
      try {
        // Check if diagram with this filename already exists
        const existingDiagram = Array.from(this.diagrams.values()).find(
          diagram => diagram.filename === filename
        );

        if (existingDiagram) {
          console.log(`Skipping duplicate file: ${filename}`);
          duplicateCount++;
          continue;
        }

        await this.addDiagram(filename, content);
        successCount++;
      } catch (error) {
        console.error(`Error processing ${filename}:`, error);
      }
    }

    if (successCount > 0) {
      this.updateDiagramList();

      // If no diagram is selected, select the first one and make it visible
      if (!this.selectedDiagramId && this.diagrams.size > 0) {
        const firstDiagram = this.diagrams.values().next().value;
        this.visibleDiagrams.add(firstDiagram.id);
        this.selectDiagram(firstDiagram.id, true); // Auto-focus when first loading
      }

      this.updateDiagramVisibility();
      if (this.connectionVisibility !== 'none') {
        this.updateConnections();
      }
      this.fitAllDiagrams();
    }

    // Show appropriate message based on results
    if (duplicateCount > 0 && successCount > 0) {
      console.info(`Added ${successCount} new diagrams. Skipped ${duplicateCount} duplicate files.`);
    } else if (duplicateCount > 0 && successCount === 0) {
      console.info(`No new diagrams added. All ${duplicateCount} files were already loaded.`);
    } else if (successCount < totalFiles - duplicateCount) {
      this.showError(`Successfully loaded ${successCount} out of ${totalFiles - duplicateCount} new diagrams.`);
    }
  }

  // Cache management methods
  invalidateConnectionCache() {
    this.connectionCache.clear();
    this.labelSetCache.clear();
    this.allConnections = [];
    this.connectionsCacheValid = false;
  }

  getCachedLabelSet(diagramId) {
    if (!this.labelSetCache.has(diagramId)) {
      const diagram = this.diagrams.get(diagramId);
      if (diagram) {
        this.labelSetCache.set(diagramId, new Set(diagram.labels));
      }
    }
    return this.labelSetCache.get(diagramId);
  }

  getCachedConnectionKey(id1, id2) {
    return id1 < id2 ? `${id1}-${id2}` : `${id2}-${id1}`;
  }

  checkAutoHideConnections() {
    const diagramCount = this.diagrams.size;
    const shouldHideConnections = diagramCount > 10;

    // Only change if the state needs to change to avoid unnecessary updates
    if (shouldHideConnections && this.connectionVisibility === 'all') {
      // Auto-enable hide connections
      this.connectionVisibility = 'none';
      this.connectionVisibilitySelect.value = 'none';
      this.connectionVisibilitySelect.title = 'Auto-hidden due to diagram count';
      this.hideAllConnections();

      // Show a brief notification
      console.info(`Auto-hiding connections due to ${diagramCount} diagrams for better performance`);
    } else if (!shouldHideConnections && this.connectionVisibility === 'none' && diagramCount <= 10) {
      // Auto-disable hide connections when count drops to 10 or below
      // But only if it was auto-hidden (not manually hidden by user)
      if (this.connectionVisibilitySelect.title.includes('Auto-hidden')) {
        this.connectionVisibility = 'all';
        this.connectionVisibilitySelect.value = 'all';
        this.connectionVisibilitySelect.title = '';

        // Show connections since we're auto-enabling them
        this.updateConnections();

        console.info(`Auto-showing connections with ${diagramCount} diagrams`);
      }
    }
  }

  async addDiagram(filename, dotContent) {
    // Generate SVG from DOT content using Graphviz
    const svgContent = await this.renderDotToSvg(dotContent);

    // Parse SVG to get actual dimensions
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
    const svgElement = svgDoc.documentElement;

    let originalWidth = 400;
    let originalHeight = 300;

    if (svgElement && svgElement.tagName === 'svg') {
      // Try to get dimensions from various attributes
      const width = svgElement.getAttribute('width');
      const height = svgElement.getAttribute('height');
      const viewBox = svgElement.getAttribute('viewBox');

      if (width && height) {
        originalWidth = parseFloat(width.replace(/[^\d.]/g, '')) || 400;
        originalHeight = parseFloat(height.replace(/[^\d.]/g, '')) || 300;
      } else if (viewBox) {
        const [, , vbWidth, vbHeight] = viewBox.split(' ').map(parseFloat);
        originalWidth = vbWidth || 400;
        originalHeight = vbHeight || 300;
      }
    }

    // Calculate container size with padding
    const padding = 40;
    const headerHeight = 50;
    const containerWidth = Math.max(350, originalWidth + padding);
    const containerHeight = Math.max(250, originalHeight + headerHeight + padding);

    // Extract labels from DOT content
    const labels = this.extractLabelsFromDot(dotContent);

    // Create diagram data
    const diagramData = {
      id: this.generateId(),
      filename,
      dotContent,
      svgContent,
      originalWidth,
      originalHeight,
      position: { ...this.nextDiagramPosition },
      size: { width: containerWidth, height: containerHeight },
      labels: labels
    };

    // Add to diagrams map
    this.diagrams.set(diagramData.id, diagramData);

    // Invalidate connection cache since we added a new diagram
    this.invalidateConnectionCache();

    // Auto-enable hide connections when we have more than 10 diagrams
    this.checkAutoHideConnections();

    // Render diagram on canvas
    this.renderDiagram(diagramData);

    // Calculate next position based on actual diagram size
    this.updateNextPosition(diagramData.size.width, diagramData.size.height);

    return diagramData;
  }

  async renderDotToSvg(dotContent) {
    return new Promise((resolve, reject) => {
      try {
        // Create a temporary container
        const tempDiv = document.createElement('div');
        tempDiv.style.visibility = 'hidden';
        tempDiv.style.position = 'absolute';
        tempDiv.style.width = '800px';
        tempDiv.style.height = '600px';
        document.body.appendChild(tempDiv);

        // Use d3-graphviz to render
        const graphviz = d3.select(tempDiv)
          .graphviz()
          .fit(false)
          .zoom(false)
          .on('end', () => {
            const svg = tempDiv.querySelector('svg');
            if (svg) {
              const svgContent = svg.outerHTML;
              document.body.removeChild(tempDiv);
              resolve(svgContent);
            } else {
              document.body.removeChild(tempDiv);
              reject(new Error('Failed to generate SVG'));
            }
          });

        graphviz.renderDot(dotContent);
      } catch (error) {
        reject(error);
      }
    });
  }

  renderDiagram(diagramData) {
    const container = this.viewport.append('g')
      .attr('class', 'diagram-container')
      .attr('id', `diagram-${diagramData.id}`)
      .attr('transform', `translate(${diagramData.position.x}, ${diagramData.position.y})`);

    // Background
    const bg = container.append('rect')
      .attr('class', 'diagram-bg')
      .attr('width', diagramData.size.width)
      .attr('height', diagramData.size.height)
      .attr('rx', 12)
      .attr('fill', 'white')
      .attr('stroke', '#e2e8f0')
      .attr('stroke-width', 1)
      .style('filter', 'drop-shadow(0px 8px 32px rgba(0, 0, 0, 0.1))');

    // Header with rounded top corners only using a path
    const header = container.append('g')
      .attr('class', 'diagram-header')

    const headerWidth = diagramData.size.width - 2; // Account for 1px border on each side
    header.append('path')
      .attr('fill', '#f8fafc')
      .attr('stroke-width', '0')
      .attr('d', `m1 50v-38s0-11 11-11h${headerWidth - 22}s11 0 11 11v38`);

    // Title
    const displayName = diagramData.filename.replace(/\.dot$/i, '');
    header.append('text')
      .attr('x', 16)
      .attr('y', 26)
      .attr('class', 'diagram-title')
      .style('font-family', 'monospace')
      .style('font-size', '14px')
      .style('font-weight', '500')
      .style('fill', '#1e293b')
      .text(displayName);

    // Content area
    const contentPadding = 20;
    const headerHeight = 50;
    const content = container.append('g')
      .attr('class', 'diagram-content')
      .attr('transform', `translate(${contentPadding}, ${headerHeight})`);

    // Parse and add SVG content
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(diagramData.svgContent, 'image/svg+xml');
    const svgElement = svgDoc.documentElement;

    if (svgElement && svgElement.tagName === 'svg') {
      // Use pre-calculated dimensions from addDiagram
      const originalWidth = diagramData.originalWidth;
      const originalHeight = diagramData.originalHeight;

      // Calculate available space
      const availableWidth = diagramData.size.width - (contentPadding * 2);
      const availableHeight = diagramData.size.height - headerHeight - contentPadding;

      // Calculate scale to fit with some margin
      const scale = Math.min(
        availableWidth / originalWidth,
        availableHeight / originalHeight,
        1
      ) * 0.9; // 10% margin for safety

      // Center the scaled content
      const scaledWidth = originalWidth * scale;
      const scaledHeight = originalHeight * scale;
      const offsetX = Math.max(0, (availableWidth - scaledWidth) / 2);
      const offsetY = Math.max(0, (availableHeight - scaledHeight) / 2);

      // Add scaled and centered SVG content
      const svgContent = content.append('g')
        .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);

      // Copy SVG children
      Array.from(svgElement.children).forEach(child => {
        svgContent.node().appendChild(child.cloneNode(true));
      });
    }

    // Add interaction
    container
      .style('cursor', 'grab')
      .on('mousedown', (event) => {
        event.stopPropagation();
        this.startDiagramDrag(event, diagramData);
      })
      .on('click', (event) => {
        event.stopPropagation();
        if (!this.isDraggingDiagram) {
          this.selectDiagram(diagramData.id, false);
        }
      })
      .on('dblclick', (event) => {
        event.stopPropagation();
        this.focusOnDiagram(diagramData.id);
      });
  }

  updateNextPosition(lastDiagramWidth = 400, lastDiagramHeight = 300) {
    // Get canvas dimensions for proper wrapping
    const canvasRect = this.svg.node().getBoundingClientRect();
    const maxWidth = canvasRect.width - 100; // Leave some margin

    // Track the maximum height in current row
    this.currentRowMaxHeight = Math.max(this.currentRowMaxHeight, lastDiagramHeight);

    // Use actual diagram width plus padding for spacing
    const spacing = lastDiagramWidth + 30; // 30px gap between diagrams
    this.nextDiagramPosition.x += spacing;

    // Check if we need to wrap to next row
    if (this.nextDiagramPosition.x + 400 > maxWidth) { // 400 is avg diagram width
      // Move to next row using the actual height of the tallest diagram in current row
      this.currentRowStartY += this.currentRowMaxHeight + 30; // 30px vertical gap
      this.nextDiagramPosition.x = 50;
      this.nextDiagramPosition.y = this.currentRowStartY;

      // Reset row height tracking for new row
      this.currentRowMaxHeight = lastDiagramHeight; // Start tracking with current diagram
    }
  }

  selectDiagram(diagramId, shouldAutoFocus = false) {
    // Clear previous selection
    this.viewport.selectAll('.diagram-container')
      .select('.diagram-bg')
      .attr('stroke', '#e2e8f0')
      .attr('stroke-width', 1);

    // Highlight selected diagram - only the main background border
    this.viewport.select(`#diagram-${diagramId}`)
      .select('.diagram-bg')
      .attr('stroke', '#3b82f6')
      .attr('stroke-width', 2);

    this.activeDiagram = diagramId;
    this.selectedDiagramId = diagramId;

    // Check if the diagram is already visible
    const wasAlreadyVisible = this.visibleDiagrams.has(diagramId);

    if (wasAlreadyVisible) {
      // If already visible, just focus on it without changing visibility
      if (shouldAutoFocus) {
        const diagram = this.diagrams.get(diagramId);
        if (diagram) {
          const centerX = diagram.position.x + diagram.size.width / 2;
          const centerY = diagram.position.y + diagram.size.height / 2;
          // Focus without fitting to screen (explicitly preserve current zoom level)
          this.animateToPosition(centerX, centerY, this.currentScale);
        }
      }
    } else {
      // If not visible, clear all and show only this one
      this.visibleDiagrams.clear();
      this.visibleDiagrams.add(diagramId);

      // Update diagram visibility and connections
      this.updateDiagramVisibility();
      this.updateConnections();

      // Auto-focus and fit to screen for newly visible diagram
      if (shouldAutoFocus) {
        const diagram = this.diagrams.get(diagramId);
        if (diagram) {
          const centerX = diagram.position.x + diagram.size.width / 2;
          const centerY = diagram.position.y + diagram.size.height / 2;
          // Fit to screen with scale = 1
          this.animateToPosition(centerX, centerY, 1);
        }
      }
    }

    this.updateDiagramList();
  }

  focusOnDiagram(diagramId) {
    const diagram = this.diagrams.get(diagramId);
    if (!diagram) return;

    const centerX = diagram.position.x + diagram.size.width / 2;
    const centerY = diagram.position.y + diagram.size.height / 2;

    this.animateToPosition(centerX, centerY, 1);
    this.selectDiagram(diagramId);
  }

  updateDiagramList() {
    const listContainer = this.diagramList;

    if (this.diagrams.size === 0) {
      listContainer.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                    </svg>
                    <p>No diagrams loaded</p>
                    <p class="subtitle">Click "Load DOT Files" to get started</p>
                </div>
            `;
    } else {
      listContainer.innerHTML = '';

      this.diagrams.forEach((diagram, id) => {
        const item = document.createElement('div');
        item.className = `diagram-item ${id === this.activeDiagram ? 'active' : ''}`;
        const isVisible = this.visibleDiagrams.has(id);
        item.innerHTML = `
                    <div class="diagram-checkbox">
                        <input type="checkbox" id="checkbox-${id}" ${isVisible ? 'checked' : ''}>
                        <label for="checkbox-${id}" class="checkbox-label">
                            <svg class="checkbox-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20,6 9,17 4,12"></polyline>
                            </svg>
                        </label>
                    </div>
                    <div class="info">
                        <div class="name">${diagram.filename.replace(/\.dot$/i, '')}</div>
                        <div class="meta">${diagram.size.width}×${diagram.size.height}</div>
                    </div>
                    <div class="actions">
                        <button class="action-btn" title="Focus" data-action="focus" data-id="${id}">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="11" cy="11" r="8"></circle>
                                <path d="21 21l-4.35-4.35"></path>
                            </svg>
                        </button>
                        <button class="action-btn" title="Delete" data-action="delete" data-id="${id}">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3,6 5,6 21,6"></polyline>
                                <path d="19,6 19,20 7,20 7,6"></path>
                                <path d="10,11 10,17"></path>
                                <path d="14,11 14,17"></path>
                            </svg>
                        </button>
                    </div>
                `;

        // Add checkbox handler
        const checkbox = item.querySelector(`#checkbox-${id}`);
        checkbox.addEventListener('change', (e) => {
          e.stopPropagation();
          this.toggleDiagramVisibility(id, e.target.checked);
        });

        // Add click handlers
        item.addEventListener('click', (e) => {
          if (!e.target.closest('.actions') && !e.target.closest('.diagram-checkbox')) {
            this.selectDiagram(id, true); // Auto-focus when selecting from sidebar
          }
        });

        item.addEventListener('dblclick', (e) => {
          if (!e.target.closest('.actions') && !e.target.closest('.diagram-checkbox')) {
            this.focusOnDiagram(id);
          }
        });

        // Add action handlers
        item.querySelectorAll('.action-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const diagramId = btn.dataset.id;

            if (action === 'focus') {
              this.focusOnDiagram(diagramId);
            } else if (action === 'delete') {
              this.deleteDiagram(diagramId);
            }
          });
        });

        listContainer.appendChild(item);
      });
    }

    this.diagramCount.textContent = this.diagrams.size;
  }

  deleteDiagram(diagramId) {
    this.viewport.select(`#diagram-${diagramId}`).remove();
    this.diagrams.delete(diagramId);

    // Invalidate connection cache since we removed a diagram
    this.invalidateConnectionCache();

    // Check if we should auto-disable hide connections
    this.checkAutoHideConnections();

    if (this.activeDiagram === diagramId) {
      this.activeDiagram = null;
    }

    if (this.selectedDiagramId === diagramId) {
      this.selectedDiagramId = null;

      // If there are other diagrams, select the first one and make it visible
      if (this.diagrams.size > 0) {
        const firstDiagram = this.diagrams.values().next().value;
        this.visibleDiagrams.add(firstDiagram.id);
        this.selectDiagram(firstDiagram.id, true); // Auto-focus when switching after deletion
      }
    }

    // Remove from visible diagrams set
    this.visibleDiagrams.delete(diagramId);

    this.updateDiagramList();
    this.updateDiagramVisibility();
    if (this.connectionVisibility !== 'none') {
      this.updateConnections();
    }
  }

  clearAllDiagrams() {
    // Remove all diagram elements from the SVG
    this.viewport.selectAll('.diagram-container').remove();

    // Clear connections
    this.viewport.selectAll('.connection-line').remove();
    this.viewport.selectAll('.connection-label-bg').remove();
    this.viewport.selectAll('.connection-label-text').remove();
    this.viewport.selectAll('.connection-arrow-group').remove();

    // Clear the diagrams map
    this.diagrams.clear();

    // Clear all caches
    this.invalidateConnectionCache();

    // Check if we should auto-disable hide connections
    this.checkAutoHideConnections();

    // Reset active diagram
    this.activeDiagram = null;
    this.selectedDiagramId = null;
    this.visibleDiagrams.clear();

    // Reset diagram position for new ones
    this.nextDiagramPosition = { x: 50, y: 50 };
    this.currentRowMaxHeight = 0;
    this.currentRowStartY = 50;

    // Update the UI
    this.updateDiagramList();
  }

  // Zoom and pan functionality
  zoomIn() {
    this.svg.transition().duration(300).call(
      this.zoom.scaleBy, 1.5
    );
  }

  zoomOut() {
    this.svg.transition().duration(300).call(
      this.zoom.scaleBy, 1 / 1.5
    );
  }

  resetView() {
    this.svg.transition().duration(500).call(
      this.zoom.transform,
      d3.zoomIdentity
    );
  }

  fitAllDiagrams() {
    if (this.diagrams.size === 0) return;

    let diagramsToFit = [];

    // Only fit visible diagrams
    diagramsToFit = Array.from(this.diagrams.values()).filter(diagram =>
      this.visibleDiagrams.has(diagram.id)
    );

    if (diagramsToFit.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    diagramsToFit.forEach(diagram => {
      minX = Math.min(minX, diagram.position.x);
      minY = Math.min(minY, diagram.position.y);
      maxX = Math.max(maxX, diagram.position.x + diagram.size.width);
      maxY = Math.max(maxY, diagram.position.y + diagram.size.height);
    });

    const bounds = {
      x: minX - 50,
      y: minY - 50,
      width: maxX - minX + 100,
      height: maxY - minY + 100
    };

    const svgRect = this.svg.node().getBoundingClientRect();
    const scale = Math.min(
      svgRect.width / bounds.width,
      svgRect.height / bounds.height,
      1
    ) * 0.9;

    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    const transform = d3.zoomIdentity
      .translate(svgRect.width / 2, svgRect.height / 2)
      .scale(scale)
      .translate(-centerX, -centerY);

    this.svg.transition().duration(750).call(
      this.zoom.transform,
      transform
    );
  }

  updateConnectionVisibility(event) {
    this.connectionVisibility = event.target.value;

    // Clear any auto-hide title when user manually changes setting
    this.connectionVisibilitySelect.title = '';

    // Update connections based on new visibility setting
    this.updateConnections();
  }

  toggleTransitiveConnections() {
    this.hideTransitive = !this.hideTransitive;

    // Update button appearance
    if (this.hideTransitive) {
      this.hideTransitiveBtn.classList.add('btn-active');
      this.hideTransitiveBtn.title = 'Show transitive connections';
    } else {
      this.hideTransitiveBtn.classList.remove('btn-active');
      this.hideTransitiveBtn.title = 'Hide transitive connections';
    }

    // Only update if connections are visible
    if (this.connectionVisibility !== 'none') {
      this.updateConnections();
    }
  }

  hideAllConnections() {
    // Remove all connection elements immediately
    this.viewport.selectAll('.connection-line').remove();
    this.viewport.selectAll('.connection-label-bg').remove();
    this.viewport.selectAll('.connection-label-text').remove();
    this.viewport.selectAll('.connection-arrow-group').remove();
  }

  updateMinSharedLabels(event) {
    const value = parseInt(event.target.value) || 0;
    this.minSharedLabels = Math.max(0, value); // Ensure non-negative

    // Update the input value to reflect the processed value
    event.target.value = this.minSharedLabels;

    // Only update if connections are visible
    if (this.connectionVisibility !== 'none') {
      this.updateConnections();
    }
  }

  selectAllDiagrams() {
    // Add all diagrams to visible set
    this.diagrams.forEach((diagram, id) => {
      this.visibleDiagrams.add(id);
    });

    // Update UI
    this.updateDiagramVisibility();
    if (this.connectionVisibility !== 'none') {
      this.updateConnections();
    }
    this.updateDiagramList();

    // Automatically fit all diagrams to screen
    this.fitAllDiagrams();
  }

  unselectAllDiagrams() {
    // Clear all diagrams from visible set
    this.visibleDiagrams.clear();

    // Update UI
    this.updateDiagramVisibility();
    if (this.connectionVisibility !== 'none') {
      this.updateConnections();
    }
    this.updateDiagramList();
  }

  toggleDiagramVisibility(diagramId, isVisible) {
    const wasEmpty = this.visibleDiagrams.size === 0;

    if (isVisible) {
      this.visibleDiagrams.add(diagramId);
    } else {
      this.visibleDiagrams.delete(diagramId);
    }

    this.updateDiagramVisibility();
    if (this.connectionVisibility !== 'none') {
      this.updateConnections();
    }

    // If this is the first diagram being selected from empty state, focus on it
    if (isVisible && wasEmpty && this.visibleDiagrams.size === 1) {
      this.focusOnDiagram(diagramId);
    }
  }

  updateDiagramVisibility() {
    // Remove any existing empty state message
    this.svg.select('.empty-canvas-overlay').remove();

    this.diagrams.forEach((diagram, id) => {
      const diagramElement = d3.select(`#diagram-${id}`);

      // Only show diagrams that are explicitly checked (in visible set)
      const isVisible = this.visibleDiagrams.has(id);
      diagramElement.style('display', isVisible ? 'block' : 'none');
    });

    // Show empty state message if no diagrams are visible and some exist
    if (this.visibleDiagrams.size === 0 && this.diagrams.size > 0) {
      this.showEmptyCanvasMessage();
    }
  }

  showEmptyCanvasMessage() {
    // Remove any existing message first
    d3.select('#mainSvg').select('.empty-canvas-overlay').remove();

    // Create a fixed overlay that sits above the viewport
    const canvasRect = this.svg.node().getBoundingClientRect();
    const centerX = canvasRect.width / 2;
    const centerY = canvasRect.height / 2;

    // Add overlay group directly to SVG (not viewport) so it's not affected by zoom/pan
    const overlayGroup = this.svg.append('g')
      .attr('class', 'empty-canvas-overlay')
      .attr('transform', `translate(${centerX}, ${centerY})`);

    // Add background rectangle
    overlayGroup.append('rect')
      .attr('x', -140)
      .attr('y', -60)
      .attr('width', 280)
      .attr('height', 120)
      .attr('rx', 12)
      .attr('fill', '#ffffff')
      .attr('stroke', '#e2e8f0')
      .attr('stroke-width', 1)
      .attr('opacity', 0.95)
      .style('filter', 'drop-shadow(0 4px 6px rgba(0, 0, 0, 0.1))');

    // Add icon
    const iconGroup = overlayGroup.append('g')
      .attr('transform', 'translate(0, -20)');

    // Document icon
    iconGroup.append('rect')
      .attr('x', -12)
      .attr('y', -12)
      .attr('width', 24)
      .attr('height', 24)
      .attr('rx', 2)
      .attr('fill', 'none')
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 2);

    // Lines inside document
    iconGroup.append('line')
      .attr('x1', -8)
      .attr('y1', -6)
      .attr('x2', 8)
      .attr('y2', -6)
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 1);

    iconGroup.append('line')
      .attr('x1', -8)
      .attr('y1', 0)
      .attr('x2', 8)
      .attr('y2', 0)
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 1);

    iconGroup.append('line')
      .attr('x1', -8)
      .attr('y1', 6)
      .attr('x2', 4)
      .attr('y2', 6)
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 1);

    // Main message
    overlayGroup.append('text')
      .attr('text-anchor', 'middle')
      .attr('y', 15)
      .attr('font-size', '16px')
      .attr('font-weight', '600')
      .attr('fill', '#334155')
      .text('No diagrams selected');

    // Instruction - split into multiple lines
    overlayGroup.append('text')
      .attr('text-anchor', 'middle')
      .attr('y', 35)
      .attr('font-size', '13px')
      .attr('fill', '#64748b')
      .text('Select diagrams using checkboxes');

    overlayGroup.append('text')
      .attr('text-anchor', 'middle')
      .attr('y', 50)
      .attr('font-size', '13px')
      .attr('fill', '#64748b')
      .text('or click "Select All"');
  }

  animateToPosition(x, y, scale = this.currentScale) {
    const svgRect = this.svg.node().getBoundingClientRect();
    const transform = d3.zoomIdentity
      .translate(svgRect.width / 2, svgRect.height / 2)
      .scale(scale)
      .translate(-x, -y);

    this.svg.transition().duration(500).call(
      this.zoom.transform,
      transform
    );
  }

  updateZoomLevel() {
    this.zoomLevel.textContent = `${Math.round(this.currentScale * 100)}%`;
  }

  // Mouse interaction handlers
  handleMouseDown(event) {
    if (event.button === 0) { // Left mouse button
      this.isDragging = true;
      this.dragStart = { x: event.clientX, y: event.clientY };
      this.svg.style('cursor', 'grabbing');
    }
  }

  handleMouseMove(event) {
    if (this.isDragging) {
      const dx = event.clientX - this.dragStart.x;
      const dy = event.clientY - this.dragStart.y;

      // This is handled by d3.zoom, but we can add custom behavior here if needed
    }
  }

  handleMouseUp() {
    this.isDragging = false;
    this.svg.style('cursor', 'grab');
  }

  handleWheel(event) {
    // Prevent default zoom, let d3.zoom handle it
    event.preventDefault();
  }

  handleKeyDown(event) {
    if (event.ctrlKey || event.metaKey) {
      switch (event.key) {
        case '0':
          event.preventDefault();
          this.resetView();
          break;
        case '=':
        case '+':
          event.preventDefault();
          this.zoomIn();
          break;
        case '-':
          event.preventDefault();
          this.zoomOut();
          break;
        case 'f':
          event.preventDefault();
          this.fitAllDiagrams();
          break;
      }
    }
  }

  // Utility functions
  generateId() {
    return 'diagram_' + Math.random().toString(36).substr(2, 9);
  }

  extractLabelsFromDot(dotContent) {
    const labels = new Set();

    try {
      // Check if dotparser is available
      if (typeof dotParser === 'undefined') {
        console.error('dotParser library not loaded');
        return [];
      }

      // Parse DOT content using dotparser
      const parsed = dotParser.parse(dotContent);

      // Function to recursively extract nodes from parsed structure
      const extractNodes = (items) => {
        if (!items) return;

        items.forEach(item => {
          if (!item?.attr_list) {
            return;
          }

          const labelAttr = item.attr_list.find(attr => attr.id === 'label');
          if (!labelAttr) {
            return;
          }

          labels.add(labelAttr.eq);
        });
      };

      // Extract nodes from all graphs in the parsed structure
      parsed.forEach(graph => {
        if (graph.children) {
          extractNodes(graph.children);
        }
      });

    } catch (error) {
      console.error('Error parsing DOT content:', error);
      console.log('DOT content:', dotContent);
      // Fallback: return empty set if parsing fails
      return [];
    }

    return Array.from(labels);
  }

  calculateSharedLabels(labels1, labels2) {
    const set1 = new Set(labels1);
    const shared = labels2.filter(label => set1.has(label));
    return shared;
  }

  // Optimized cached version for diagram pairs
  calculateSharedLabelsForDiagrams(diagram1, diagram2) {
    const cacheKey = this.getCachedConnectionKey(diagram1.id, diagram2.id);

    if (this.connectionCache.has(cacheKey)) {
      return this.connectionCache.get(cacheKey).sharedLabels;
    }

    // Calculate and cache the result
    const set1 = this.getCachedLabelSet(diagram1.id);
    const shared = diagram2.labels.filter(label => set1.has(label));

    // Cache the full relationship data
    const relationshipData = {
      sharedLabels: shared,
      sharedCount: shared.length,
      diagram1IsSubset: shared.length > 0 && this.isSubsetCached(diagram1.labels, diagram2.labels),
      diagram2IsSubset: shared.length > 0 && this.isSubsetCached(diagram2.labels, diagram1.labels)
    };

    this.connectionCache.set(cacheKey, relationshipData);
    return shared;
  }

  updateConnections() {
    // Remove empty state message
    this.svg.select('.empty-canvas-overlay').remove();

    // Skip all connection calculations if connections are hidden
    if (this.connectionVisibility === 'none') {
      this.hideAllConnections();
      // Show empty state message if no diagrams are visible and some exist
      if (this.visibleDiagrams.size === 0 && this.diagrams.size > 0) {
        this.showEmptyCanvasMessage();
      }
      return;
    }

    // Build all connections cache if needed
    if (!this.connectionsCacheValid) {
      this.buildAllConnectionsCache();
    }

    // Filter connections to only visible diagrams
    const visibleConnections = this.allConnections.filter(connection => {
      if (connection.type === 'subset') {
        return this.visibleDiagrams.has(connection.fromId) && this.visibleDiagrams.has(connection.toId);
      } else {
        return this.visibleDiagrams.has(connection.diagram1.id) && this.visibleDiagrams.has(connection.diagram2.id);
      }
    });

    // Apply filters
    let connectionsToRender = visibleConnections;

    // Filter by connection visibility setting
    if (this.connectionVisibility === 'subset') {
      // Only show subset connections
      connectionsToRender = connectionsToRender.filter(connection => connection.type === 'subset');
    }

    // Filter out transitive connections if the toggle is enabled
    if (this.hideTransitive) {
      connectionsToRender = this.filterTransitiveConnections(connectionsToRender);
    }

    // Filter by minimum shared labels (but keep all subset connections)
    if (this.minSharedLabels > 0) {
      connectionsToRender = connectionsToRender.filter(connection => {
        // Always keep subset connections regardless of shared count
        if (connection.type === 'subset') {
          return true;
        }
        // For shared connections, check if they meet the minimum threshold
        return connection.sharedCount > this.minSharedLabels;
      });
    }

    // Update connections using data binding for efficient updates
    this.updateConnectionElements(connectionsToRender);

    // Show empty state message if no diagrams are visible and some exist
    if (this.visibleDiagrams.size === 0 && this.diagrams.size > 0) {
      this.showEmptyCanvasMessage();
    }
  }

  updateConnectionElements(connectionsToRender) {
    // Separate connections by type for different handling
    const sharedConnections = connectionsToRender.filter(c => c.type === 'shared');
    const subsetConnections = connectionsToRender.filter(c => c.type === 'subset');

    // Update shared connections (lines with labels)
    this.updateSharedConnections(sharedConnections);

    // Update subset connections (arrows)
    this.updateSubsetConnections(subsetConnections);
  }

  updateSharedConnections(connections) {
    // Generate unique IDs for connections
    const connectionsWithIds = connections.map(conn => ({
      ...conn,
      id: this.getCachedConnectionKey(conn.diagram1.id, conn.diagram2.id)
    }));

    // Update connection lines using D3 data binding
    const lines = this.viewport.selectAll('.connection-line')
      .data(connectionsWithIds, d => d.id);

    // Remove connections that are no longer needed
    lines.exit().remove();

    // Add new connection lines
    const newLines = lines.enter()
      .append('line')
      .attr('class', 'connection-line')
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '5,5')
      .attr('opacity', 0.6);

    // Update positions for all lines (existing + new)
    lines.merge(newLines)
      .attr('x1', d => d.diagram1.position.x + d.diagram1.size.width / 2)
      .attr('y1', d => d.diagram1.position.y + d.diagram1.size.height / 2)
      .attr('x2', d => d.diagram2.position.x + d.diagram2.size.width / 2)
      .attr('y2', d => d.diagram2.position.y + d.diagram2.size.height / 2);

    // Update connection label backgrounds
    const labelBgs = this.viewport.selectAll('.connection-label-bg')
      .data(connectionsWithIds, d => d.id);

    labelBgs.exit().remove();

    const newLabelBgs = labelBgs.enter()
      .append('rect')
      .attr('class', 'connection-label-bg')
      .attr('width', 60)
      .attr('height', 20)
      .attr('rx', 10)
      .attr('fill', '#ffffff')
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 1);

    labelBgs.merge(newLabelBgs)
      .attr('x', d => {
        const midX = (d.diagram1.position.x + d.diagram1.size.width / 2 +
          d.diagram2.position.x + d.diagram2.size.width / 2) / 2;
        return midX - 30;
      })
      .attr('y', d => {
        const midY = (d.diagram1.position.y + d.diagram1.size.height / 2 +
          d.diagram2.position.y + d.diagram2.size.height / 2) / 2;
        return midY - 10;
      });

    // Update connection label texts
    const labelTexts = this.viewport.selectAll('.connection-label-text')
      .data(connectionsWithIds, d => d.id);

    labelTexts.exit().remove();

    const newLabelTexts = labelTexts.enter()
      .append('text')
      .attr('class', 'connection-label-text')
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('font-family', 'monospace')
      .attr('font-weight', '500')
      .attr('fill', '#64748b');

    labelTexts.merge(newLabelTexts)
      .attr('x', d => {
        const midX = (d.diagram1.position.x + d.diagram1.size.width / 2 +
          d.diagram2.position.x + d.diagram2.size.width / 2) / 2;
        return midX;
      })
      .attr('y', d => {
        const midY = (d.diagram1.position.y + d.diagram1.size.height / 2 +
          d.diagram2.position.y + d.diagram2.size.height / 2) / 2;
        return midY + 4;
      })
      .text(d => `${d.sharedCount} shared`);
  }

  updateSubsetConnections(connections) {
    // Generate unique IDs for subset connections
    const connectionsWithIds = connections.map(conn => ({
      ...conn,
      id: `subset-${conn.fromId}-${conn.toId}`
    }));

    // Update subset arrows using D3 data binding
    const arrowGroups = this.viewport.selectAll('.connection-arrow-group')
      .data(connectionsWithIds, d => d.id);

    // Remove arrows that are no longer needed
    arrowGroups.exit().remove();

    // Add new arrow groups
    const newArrowGroups = arrowGroups.enter()
      .append('g')
      .attr('class', 'connection-arrow-group');

    // Add arrow line to new groups
    newArrowGroups.append('line')
      .attr('class', 'connection-arrow-line')
      .attr('stroke', '#ef4444')
      .attr('stroke-width', 2)
      .attr('marker-end', 'url(#arrowhead)');

    // Add arrow label background to new groups
    newArrowGroups.append('rect')
      .attr('class', 'connection-arrow-label-bg')
      .attr('width', 50)
      .attr('height', 18)
      .attr('rx', 9)
      .attr('fill', '#ffffff')
      .attr('stroke', '#ef4444')
      .attr('stroke-width', 1);

    // Add arrow label text to new groups
    newArrowGroups.append('text')
      .attr('class', 'connection-arrow-label-text')
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .attr('font-weight', '500')
      .attr('fill', '#dc2626')
      .text('subset');

    // Update positions for all arrow groups (existing + new)
    const allArrowGroups = arrowGroups.merge(newArrowGroups);

    allArrowGroups.each(function (d) {
      const group = d3.select(this);
      const positions = calculateArrowPositions(d.from, d.to);

      // Update arrow line
      group.select('.connection-arrow-line')
        .attr('x1', positions.x1)
        .attr('y1', positions.y1)
        .attr('x2', positions.x2)
        .attr('y2', positions.y2);

      // Update label background
      group.select('.connection-arrow-label-bg')
        .attr('x', positions.labelX - 25)
        .attr('y', positions.labelY - 9);

      // Update label text
      group.select('.connection-arrow-label-text')
        .attr('x', positions.labelX)
        .attr('y', positions.labelY + 3);
    });

    // Helper function to calculate arrow positions
    function calculateArrowPositions(fromDiagram, toDiagram) {
      const x1 = fromDiagram.position.x + fromDiagram.size.width / 2;
      const y1 = fromDiagram.position.y + fromDiagram.size.height / 2;
      const x2 = toDiagram.position.x + toDiagram.size.width / 2;
      const y2 = toDiagram.position.y + toDiagram.size.height / 2;

      const angle = Math.atan2(y2 - y1, x2 - x1);
      const distance = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

      const fromRadius = Math.min(fromDiagram.size.width, fromDiagram.size.height) / 2;
      const toRadius = Math.min(toDiagram.size.width, toDiagram.size.height) / 2;

      const startX = x1 + Math.cos(angle) * (fromRadius + 10);
      const startY = y1 + Math.sin(angle) * (fromRadius + 10);
      const endX = x2 - Math.cos(angle) * (toRadius + 10);
      const endY = y2 - Math.sin(angle) * (toRadius + 10);

      return {
        x1: startX,
        y1: startY,
        x2: endX,
        y2: endY,
        labelX: (startX + endX) / 2,
        labelY: (startY + endY) / 2
      };
    }
  }

  buildAllConnectionsCache() {
    const diagrams = Array.from(this.diagrams.values());
    this.allConnections = [];

    // Pre-compute all label sets for better performance
    diagrams.forEach(diagram => {
      this.getCachedLabelSet(diagram.id);
    });

    // Calculate all possible connections between diagrams
    for (let i = 0; i < diagrams.length; i++) {
      for (let j = i + 1; j < diagrams.length; j++) {
        const diagram1 = diagrams[i];
        const diagram2 = diagrams[j];
        const cacheKey = this.getCachedConnectionKey(diagram1.id, diagram2.id);

        let relationshipData;
        if (this.connectionCache.has(cacheKey)) {
          relationshipData = this.connectionCache.get(cacheKey);
        } else {
          // Calculate relationship data
          const set1 = this.getCachedLabelSet(diagram1.id);
          const sharedLabels = diagram2.labels.filter(label => set1.has(label));

          relationshipData = {
            sharedLabels: sharedLabels,
            sharedCount: sharedLabels.length,
            diagram1IsSubset: sharedLabels.length > 0 && this.isSubsetCached(diagram1.labels, diagram2.labels),
            diagram2IsSubset: sharedLabels.length > 0 && this.isSubsetCached(diagram2.labels, diagram1.labels)
          };

          this.connectionCache.set(cacheKey, relationshipData);
        }

        // Only create connections if there are shared labels
        if (relationshipData.sharedCount > 0) {
          if (relationshipData.diagram1IsSubset) {
            // All labels from diagram1 exist in diagram2 -> arrow from diagram2 to diagram1
            this.allConnections.push({
              type: 'subset',
              from: diagram2,
              to: diagram1,
              fromId: diagram2.id,
              toId: diagram1.id
            });
          } else if (relationshipData.diagram2IsSubset) {
            // All labels from diagram2 exist in diagram1 -> arrow from diagram1 to diagram2
            this.allConnections.push({
              type: 'subset',
              from: diagram1,
              to: diagram2,
              fromId: diagram1.id,
              toId: diagram2.id
            });
          } else {
            // Partial overlap -> regular connection line
            this.allConnections.push({
              type: 'shared',
              diagram1: diagram1,
              diagram2: diagram2,
              sharedCount: relationshipData.sharedCount
            });
          }
        }
      }
    }

    this.connectionsCacheValid = true;
  }

  filterTransitiveConnections(connections) {
    // Filter out transitive subset relationships
    const subsetConnections = connections.filter(conn => conn.type === 'subset');
    const sharedConnections = connections.filter(conn => conn.type === 'shared');

    // For each subset connection, check if it's transitive
    const filteredSubsetConnections = subsetConnections.filter(connection => {
      const { fromId, toId } = connection;

      // Check if there's an intermediate diagram that makes this connection transitive
      // i.e., if A -> B and B -> C, then A -> C is transitive
      const isTransitive = subsetConnections.some(otherConnection => {
        if (otherConnection === connection) return false; // Don't compare with self

        // Check if there's a path: from -> intermediate -> to
        const hasIntermediatePath = subsetConnections.some(intermediateConnection => {
          return (
            // Path: from -> intermediate -> to
            (otherConnection.fromId === fromId &&
              intermediateConnection.fromId === otherConnection.toId &&
              intermediateConnection.toId === toId) ||
            // Or: intermediate -> from and to -> intermediate (reverse direction)
            (otherConnection.toId === fromId &&
              intermediateConnection.toId === otherConnection.fromId &&
              intermediateConnection.fromId === toId)
          );
        });

        return hasIntermediatePath;
      });

      return !isTransitive;
    });

    // Return filtered subset connections plus all shared connections
    return [...filteredSubsetConnections, ...sharedConnections];
  }

  isSubset(setA, setB) {
    // Check if all labels in setA exist in setB
    const setALabels = new Set(setA);
    const setBLabels = new Set(setB);

    for (const label of setALabels) {
      if (!setBLabels.has(label)) {
        return false;
      }
    }
    return setALabels.size > 0; // Must have at least one label to be a meaningful subset
  }

  // Optimized cached version using pre-computed Sets
  isSubsetCached(setA, setB) {
    if (setA.length === 0) return false;

    const setBLabels = new Set(setB);
    for (const label of setA) {
      if (!setBLabels.has(label)) {
        return false;
      }
    }
    return true;
  }

  drawConnection(diagram1, diagram2, sharedCount) {
    // Calculate center points of both diagrams
    const x1 = diagram1.position.x + diagram1.size.width / 2;
    const y1 = diagram1.position.y + diagram1.size.height / 2;
    const x2 = diagram2.position.x + diagram2.size.width / 2;
    const y2 = diagram2.position.y + diagram2.size.height / 2;

    // Calculate midpoint for label
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    // Draw connection line
    this.viewport.append('line')
      .attr('class', 'connection-line')
      .attr('x1', x1)
      .attr('y1', y1)
      .attr('x2', x2)
      .attr('y2', y2)
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '5,5')
      .attr('opacity', 0.6);

    // Draw label background
    const labelText = `${sharedCount} shared`;
    const labelBg = this.viewport.append('rect')
      .attr('class', 'connection-label')
      .attr('x', midX - 30)
      .attr('y', midY - 10)
      .attr('width', 60)
      .attr('height', 20)
      .attr('rx', 10)
      .attr('fill', '#ffffff')
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 1);

    // Draw label text
    this.viewport.append('text')
      .attr('class', 'connection-label')
      .attr('x', midX)
      .attr('y', midY + 4)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('font-family', 'monospace')
      .attr('font-weight', '500')
      .attr('fill', '#64748b')
      .text(labelText);
  }

  drawSubsetArrow(fromDiagram, toDiagram) {
    // Calculate center points of both diagrams
    const x1 = fromDiagram.position.x + fromDiagram.size.width / 2;
    const y1 = fromDiagram.position.y + fromDiagram.size.height / 2;
    const x2 = toDiagram.position.x + toDiagram.size.width / 2;
    const y2 = toDiagram.position.y + toDiagram.size.height / 2;

    // Calculate angle for arrow positioning
    const angle = Math.atan2(y2 - y1, x2 - x1);

    // Calculate points on the edges of the diagram containers instead of centers
    const fromRadius = Math.max(fromDiagram.size.width, fromDiagram.size.height) / 2;
    const toRadius = Math.max(toDiagram.size.width, toDiagram.size.height) / 2;

    const startX = x1 + Math.cos(angle) * fromRadius * 0.7;
    const startY = y1 + Math.sin(angle) * fromRadius * 0.7;
    const endX = x2 - Math.cos(angle) * toRadius * 0.7;
    const endY = y2 - Math.sin(angle) * toRadius * 0.7;

    // Create arrow marker definition (if not already created)
    let defs = this.viewport.select('defs');
    if (defs.empty()) {
      defs = this.viewport.append('defs');
    }

    if (defs.select('#arrowhead').empty()) {
      defs.append('marker')
        .attr('id', 'arrowhead')
        .attr('markerWidth', 10)
        .attr('markerHeight', 7)
        .attr('refX', 9)
        .attr('refY', 3.5)
        .attr('orient', 'auto')
        .append('polygon')
        .attr('points', '0 0, 10 3.5, 0 7')
        .attr('fill', '#dc2626');
    }

    // Draw red arrow line
    this.viewport.append('line')
      .attr('class', 'connection-arrow')
      .attr('x1', startX)
      .attr('y1', startY)
      .attr('x2', endX)
      .attr('y2', endY)
      .attr('stroke', '#dc2626')
      .attr('stroke-width', 3)
      .attr('marker-end', 'url(#arrowhead)')
      .attr('opacity', 0.8);

    // Calculate midpoint for label
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;

    // Draw label background
    const labelBg = this.viewport.append('rect')
      .attr('class', 'connection-arrow')
      .attr('x', midX - 25)
      .attr('y', midY - 10)
      .attr('width', 50)
      .attr('height', 20)
      .attr('rx', 10)
      .attr('fill', '#ffffff')
      .attr('stroke', '#dc2626')
      .attr('stroke-width', 2);

    // Draw label text
    this.viewport.append('text')
      .attr('class', 'connection-arrow')
      .attr('x', midX)
      .attr('y', midY + 4)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('font-family', 'monospace')
      .attr('font-weight', 'bold')
      .attr('fill', '#dc2626')
      .text('subset');
  }

  showLoading(show) {
    this.loadingIndicator.style.display = show ? 'block' : 'none';
  }

  showError(message) {
    // Simple error display - could be enhanced with a proper notification system
    console.error(message);
    alert(message);
  }

  showInfo(message) {
    // Simple info display - could be enhanced with a proper notification system
    console.info(message);
    alert(message);
  }

  initializeSidebarResize() {
    let startX, startWidth;

    const handleMouseDown = (e) => {
      this.isResizing = true;
      startX = e.clientX;
      startWidth = this.sidebarWidth;

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      e.preventDefault();
    };

    const handleMouseMove = (e) => {
      if (!this.isResizing) return;

      const deltaX = e.clientX - startX;
      const newWidth = Math.max(200, Math.min(600, startWidth + deltaX));

      this.setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      this.isResizing = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    this.sidebarResizer.addEventListener('mousedown', handleMouseDown);
  }

  setSidebarWidth(width) {
    this.sidebarWidth = width;
    this.appContainer.style.gridTemplateColumns = `${width}px 1fr`;
  }

  startDiagramDrag(event, diagramData) {
    this.isDraggingDiagram = true;
    this.draggedDiagram = diagramData;

    // Get the current transform of the viewport
    const transform = d3.zoomTransform(this.svg.node());

    // Calculate mouse position in viewport coordinates
    const mouseX = (event.clientX - transform.x) / transform.k;
    const mouseY = (event.clientY - transform.y) / transform.k;

    // Calculate offset from diagram top-left corner
    this.dragOffset = {
      x: mouseX - diagramData.position.x,
      y: mouseY - diagramData.position.y
    };

    // Change cursor and prevent selection
    d3.select(`#diagram-${diagramData.id}`).style('cursor', 'grabbing');
    document.body.style.userSelect = 'none';

    // Add global mouse event listeners
    document.addEventListener('mousemove', this.handleDiagramDrag.bind(this));
    document.addEventListener('mouseup', this.endDiagramDrag.bind(this));
  }

  handleDiagramDrag(event) {
    if (!this.isDraggingDiagram || !this.draggedDiagram) return;

    // Get the current transform of the viewport
    const transform = d3.zoomTransform(this.svg.node());

    // Calculate new position in viewport coordinates
    const mouseX = (event.clientX - transform.x) / transform.k;
    const mouseY = (event.clientY - transform.y) / transform.k;

    const newX = mouseX - this.dragOffset.x;
    const newY = mouseY - this.dragOffset.y;

    // Update diagram position
    this.draggedDiagram.position.x = newX;
    this.draggedDiagram.position.y = newY;

    // Update visual position
    d3.select(`#diagram-${this.draggedDiagram.id}`)
      .attr('transform', `translate(${newX}, ${newY})`);

    // Update connections in real-time only if they're visible
    if (this.connectionVisibility !== 'none') {
      this.updateConnections();
    }
  }

  endDiagramDrag() {
    if (!this.isDraggingDiagram) return;

    // Reset cursor
    if (this.draggedDiagram) {
      d3.select(`#diagram-${this.draggedDiagram.id}`).style('cursor', 'grab');
    }
    document.body.style.userSelect = '';

    // Clean up
    this.isDraggingDiagram = false;
    this.draggedDiagram = null;
    this.dragOffset = { x: 0, y: 0 };

    // Remove global mouse event listeners
    document.removeEventListener('mousemove', this.handleDiagramDrag.bind(this));
    document.removeEventListener('mouseup', this.endDiagramDrag.bind(this));
  }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new MultiDotViewer();
});