# OutlineRider


# OutlineRider

## Description

OutlineRider is a progressive web application (PWA) for creating, editing, and managing structured outlines. It's designed as a compatible alternative to Bike Outliner by Hogbay Software, allowing you to work with `.bike` outline files even when you're away from your primary Bike installation.

The app supports various outline item types, formatting options, and persistent storage mechanisms to provide a robust outlining experience across devices.

## User Guide

### Getting Started

1. **Access the App**: Open OutlineRider in your web browser.
2. **Create Content**: Start typing in the main editor area or use the "New App File" button (if available).
3. **Save Your Work**: Use one of the available storage options (see "Storage Options" below).

### Storage Options

OutlineRider provides several ways to save your work:

- **App Storage** (supported browsers): Creates persistent storage within the browser using Origin Private File System (OPFS).
  - Click "Save to App" to store content in the app's private storage.
  - Content auto-saves periodically when edited.
  
- **Direct File Access** (Chrome/Edge): Edit files directly on your device.
  - Click "Open Direct" to select a file to edit.
  - Click "Save Direct" to save changes to the original file.

- **Download/Export**: Save content as a downloadable file.
  - Click "Save As / Download" to download the current outline as a `.bike` file.

- **Drafts**: The app automatically saves drafts to local storage in case of unexpected closure.

### Basic Editing

#### Creating and Managing Items

- **New Item**: Press Enter at the end of an existing item
- **Line Break Within Item**: Press Shift+Enter
- **Delete Item**: Press Delete or Backspace when the item is empty
- **Move Items**: 
  - Use Alt+Shift+Up/Down arrows 
  - Or click the arrow buttons in the toolbar

#### Organizing Items

- **Indent**: Tab or click the "→" button in the toolbar
- **Outdent**: Shift+Tab or click the "←" button in the toolbar
- **Fold/Unfold**: Click the triangle icon next to items with children

#### Item Types

Select an item and click one of the type buttons in the toolbar:

- **H**: Heading
- **N**: Note
- **T**: Task (with checkbox)
- **1.**: Ordered List Item
- **•**: Unordered List Item
- **—**: Horizontal Rule
- **∑**: LaTeX Math Block
- **P**: Plain Text

### Text Formatting

Select text and use the formatting buttons in the toolbar:

- **B**: Bold
- **I**: Italic
- **{}**: Code
- **H**: Highlight
- **Link**: Create a hyperlink

### Multi-selection

- **Select Multiple Items**: Hold Shift and click to select a range
- **Copy Multiple Items**: Select multiple items, then use Ctrl+C/Cmd+C

### Mobile Features

I am trying to make OutlineRider optimized for mobile devices with:
- Responsive interface that adapts to small screens
- Special handling for on-screen keyboards
- Touch-friendly controls

## Developer Guide

### Project Structure

The application follows a modular architecture:

```
bike-editor/
├── app.js                # Application entry point
├── index.html            # Main HTML structure
├── style.css             # Global styles
├── worker.js             # Web Worker for background operations
├── manifest.json         # PWA manifest
├── sw.js                 # Service Worker for offline capability
├── js/
│   ├── debug.js          # Debug utilities
│   ├── editor.js         # Core editor functionality
│   ├── fileSystem.js     # File handling & storage
│   ├── keyboard.js       # Keyboard shortcut handling
│   ├── latex.js          # LaTeX rendering
│   ├── mobile.js         # Mobile-specific features
│   ├── state.js          # Application state management
│   ├── ui.js             # UI components and interactions
│   └── utils.js          # General utility functions
```

### Core Modules

#### State Module (`state.js`)

Manages the application state including:
- Current document root
- Selected items
- File handles
- Current file source
- Dirty state

#### Editor Module (`editor.js`)

Handles core editing functionality:
- Parsing and serializing outline content
- Item manipulation (create, delete, indent, etc.)
- Item type management
- Content formatting
- Change detection

#### FileSystem Module (`fileSystem.js`)

Manages all file operations:
- OPFS (Origin Private File System) access
- Direct file editing via File System Access API
- File downloading
- Draft saving/loading
- Auto-saving

#### UI Module (`ui.js`)

Handles interface elements:
- Element caching
- Multi-selection functionality
- Updating UI state based on application state
- Focus management

### Key Technologies

- **Web File System APIs**:
  - File System Access API for direct file editing
  - Origin Private File System (OPFS) for persistent app storage

- **PWA Features**:
  - Service Worker for offline capability
  - Web app manifest for installation
  - File handling for opening `.bike` files directly

- **Web Workers**:
  - Background processing for file operations to avoid UI blocking

- **KaTeX**:
  - Math rendering library for LaTeX content

### Storage Implementation Details

The application implements three levels of storage:

1. **Primary Storage** (OPFS or Direct File):
   - Most persistent, explicit user action to save
   - Handled in fileSystem.js via `saveToOpfs()` or `saveFileDirectly()`

2. **Draft Storage** (Local Storage):
   - Automatic backup on content changes
   - Handled via `saveDraftToLocalStorage()`
   - Provides recovery if app closes unexpectedly

3. **Auto-Save** (for OPFS):
   - Periodic background saving when using App Storage
   - Implemented via `autoSaveToOpfs()`


### Mobile Optimization

The mobile.js module handles mobile-specific behaviors:
- Keyboard appearance handling
- Viewport adjustments
- Touch interaction optimizations

### Performance Considerations

- Use Web Workers for intensive operations
- Debounce frequent events (auto-save, LaTeX rendering)
- Cache DOM elements to avoid repeat queries
- Restore focus and selection after potentially disruptive operations

## Browser Compatibility

OutlineRider works best in:
- Chrome/Edge (full feature support including Direct File Access)
- Safari (App Storage support varies by version)
- Firefox (limited File System API support)


## Contact & Support