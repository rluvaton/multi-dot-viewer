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

    // Create diagram data
    const diagramData = {
      id: this.generateId(),
      filename,
      dotContent,
      svgContent,
      originalWidth,
      originalHeight,
      position: { ...this.nextDiagramPosition },
      size: { width: containerWidth, height: containerHeight }
    };

    // Add to diagrams map
    this.diagrams.set(diagramData.id, diagramData);

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

    // Create a clipping mask for the header with rounded top corners only
    const maskId = `header-mask-${diagramData.id}`;
    container.append('defs').append('clipPath')
      .attr('id', maskId)
      .append('path')
      .attr('d', `M 0,12 
                        Q 0,0 12,0 
                        L ${diagramData.size.width - 12},0 
                        Q ${diagramData.size.width},0 ${diagramData.size.width},12 
                        L ${diagramData.size.width},50 
                        L 0,50 Z`);

    // Header
    const header = container.append('g')
      .attr('class', 'diagram-header')
      .attr('clip-path', `url(#${maskId})`);

    header.append('rect')
      .attr('width', diagramData.size.width)
      .attr('height', 50)
      .attr('fill', '#f8fafc');

    // Title
    header.append('text')
      .attr('x', 16)
      .attr('y', 26)
      .attr('class', 'diagram-title')
      .style('font-size', '14px')
      .style('font-weight', '500')
      .style('fill', '#1e293b')
      .text(diagramData.filename);

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
      .style('cursor', 'pointer')
      .on('click', (event) => {
        event.stopPropagation();
        this.selectDiagram(diagramData.id);
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

  selectDiagram(diagramId) {
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
        item.innerHTML = `
                    <div class="icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <polyline points="9,9 9,15 15,12"></polyline>
                        </svg>
                    </div>
                    <div class="info">
                        <div class="name">${diagram.filename}</div>
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

        // Add click handlers
        item.addEventListener('click', (e) => {
          if (!e.target.closest('.actions')) {
            this.selectDiagram(id);
          }
        });

        item.addEventListener('dblclick', (e) => {
          if (!e.target.closest('.actions')) {
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

    if (this.activeDiagram === diagramId) {
      this.activeDiagram = null;
    }

    this.updateDiagramList();
  }

  clearAllDiagrams() {
    // Remove all diagram elements from the SVG
    this.viewport.selectAll('.diagram-container').remove();

    // Clear the diagrams map
    this.diagrams.clear();

    // Reset active diagram
    this.activeDiagram = null;

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

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    this.diagrams.forEach(diagram => {
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
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new MultiDotViewer();
}); 