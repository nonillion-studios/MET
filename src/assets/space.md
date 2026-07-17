You are a senior software architect, UX/UI designer, and full-stack engineer. Your task is not to recreate the existing interface, but to redesign the entire application from the ground up into a modern, production-ready desktop application comparable to Adobe Photoshop, Affinity Photo, Figma, DaVinci Resolve, and Microsoft Word.
The current UI is provided only to understand existing functionality. Keep the features, but completely redesign the layout, workflow, and user experience.
________________________________________
Core Vision
Create a professional desktop application for manga translation, image editing, cleaning, typesetting, and project management.
The application should feel like a commercial-grade creative suite released in 2026, following:
•	Apple's Human Interface Guidelines 
•	iOS Liquid Glass 
•	Glassmorphism 
•	Frosted Blur 
•	Floating Panels 
•	Modern Dark Theme 
•	Photoshop-style workspace 
•	Dockable panels 
•	Fully interactive interface 
The canvas must always be the primary focus.
________________________________________
Application Structure
The application should have a real landing page instead of opening directly into the editor.
Main menu:
•	Studio 
•	Professional Text Editor 
•	Recent Projects 
•	Templates 
•	Tutorials 
•	Settings 
•	Plugins 
•	Account 
________________________________________
Studio Workflow
The application workflow should naturally guide users through the editing process.
Open Project

↓

Choose Chapter

↓

Choose Page

↓

AI Detection

↓

Cleaning

↓

Drawing

↓

Typesetting

↓

Review

↓

Export
The interface should reinforce this workflow visually instead of presenting random buttons.
________________________________________
Project Management
Redesign project management into a hierarchy.
Project

 ├── Chapters

 │     ├── Original Pages

 │     ├── Cleaned Pages

 │     ├── Translation Files

 │     ├── PSD Files

 │     └── Exported Files
Users should be able to:
•	Create projects 
•	Rename projects 
•	Organize chapters 
•	Move pages 
•	Duplicate chapters 
•	Archive projects 
•	Delete projects 
•	Search projects 
•	Filter projects 
•	Favorite projects 
________________________________________
Import System
Replace the current import button with an import dialog.
Users should choose what they are importing:
•	Original Pages 
•	Cleaned Pages 
•	Translation Files 
•	PSD Project 
•	Fonts 
•	Brushes 
•	Templates 
Support:
•	PNG 
•	JPG 
•	WEBP 
•	PSD 
•	ZIP 
________________________________________
Original Page Overlay
Fix the current original page viewer.
The application should automatically match:
Original Page 001
↓
Cleaned Page 001
↓
Translation 001
based on filename or page number.
When "View Original" is enabled:
•	Original page appears as an overlay above the cleaned page. 
•	Adjustable opacity slider. 
•	Toggle shortcut. 
•	Side-by-side comparison mode. 
•	Difference mode. 
________________________________________
Studio Layout
Redesign the studio like Photoshop.
Top Bar
•	Project 
•	Edit 
•	View 
•	Image 
•	Layer 
•	Text 
•	AI 
•	Window 
•	Help 
Toolbar (Left)
Professional vertical toolbar containing:
•	Move Tool 
•	Marquee Tool 
•	Lasso 
•	Polygonal Lasso 
•	Magnetic Lasso 
•	Magic Wand 
•	Quick Selection 
•	Crop 
•	Slice 
•	Eyedropper 
•	Healing Brush 
•	Spot Healing 
•	Clone Stamp 
•	Patch Tool 
•	Content Aware Tool 
•	Brush 
•	Pencil 
•	Eraser 
•	Gradient 
•	Paint Bucket 
•	Blur 
•	Sharpen 
•	Smudge 
•	Dodge 
•	Burn 
•	Sponge 
•	Pen Tool 
•	Curvature Pen 
•	Path Selection 
•	Direct Selection 
•	Shape Tools 
•	Type Tool 
•	Hand Tool 
•	Zoom Tool 
________________________________________
Pen Tool
Implement a Photoshop-style vector Pen Tool.
Features:
•	Anchor points 
•	Bezier handles 
•	Curved paths 
•	Straight paths 
•	Editable paths 
•	Convert anchor points 
•	Vector selection 
•	Shape creation 
•	Stroke path 
•	Fill path 
________________________________________
Marquee Tool
Implement all Photoshop marquee tools:
•	Rectangular Marquee 
•	Elliptical Marquee 
•	Single Row 
•	Single Column 
Improve them with:
•	Feather 
•	Expand 
•	Contract 
•	Transform Selection 
•	Add/Subtract Selection 
•	Quick Mask Integration 
________________________________________
Brush System
Professional brush engine.
Support:
•	Import brushes 
•	Export brushes 
•	Brush presets 
•	Brush folders 
•	Brush spacing 
•	Opacity 
•	Flow 
•	Hardness 
•	Angle 
•	Scatter 
•	Pressure 
•	Smoothing 
________________________________________
Clone Stamp
Professional Clone Stamp implementation.
Support:
•	Multiple sampling modes 
•	Aligned sampling 
•	Brush integration 
•	Live preview 
________________________________________
Content Aware Tool
Professional content-aware removal.
Capabilities:
•	Remove text 
•	Remove objects 
•	Extend backgrounds 
•	Smart fill 
•	AI reconstruction 
________________________________________
Color System
Implement a complete Photoshop-style color panel.
Include:
•	Color Wheel 
•	Hue Slider 
•	RGB 
•	HSL 
•	HSV 
•	CMYK 
•	HEX Input 
•	Color Picker 
•	Eyedropper 
•	Swatches 
•	Recent Colors 
•	Saved Palettes 
•	Gradient Editor 
________________________________________
Text Editing
Text should behave like Photoshop.
Clicking a text layer should allow direct editing.
Features:
•	Resize 
•	Rotate 
•	Warp 
•	Kerning 
•	Tracking 
•	Leading 
•	Baseline Shift 
•	Character Styles 
•	Paragraph Styles 
•	Stroke 
•	Fill 
•	Shadows 
•	Glow 
•	Gradient Text 
•	Color Text 
•	Outline Text 
________________________________________
Translation Preview Panel
Add a dedicated Translation Preview panel.
Features:
•	List every translated dialogue 
•	Jump to bubble 
•	Search text 
•	Replace text 
•	Spell check 
•	Translation status 
•	Translator comments 
________________________________________
Bubble Management
Support:
Single Bubble Mode
Multi Bubble Mode
Allow selecting multiple speech bubbles and assigning multiple translated texts at once.
Users should be able to:
•	Merge bubbles 
•	Split bubbles 
•	Reorder bubbles 
•	Auto-number bubbles 
________________________________________
Professional Text Editor
The text editor should become a standalone application similar to Microsoft Word.
Features:
•	Multiple tabs 
•	Multiple documents 
•	Rich text editing 
•	Spell checker 
•	Grammar checker 
•	Find & Replace 
•	Tables 
•	Lists 
•	Headings 
•	Images 
•	Comments 
•	Track Changes 
•	Dark Mode 
•	Auto Save 
•	Version History 
Remove every placeholder.
________________________________________
Text Integration
The Studio and Text Editor must work together.
Users should be able to:
•	Send selected text directly into speech bubbles 
•	Import translated documents 
•	Synchronize updates 
•	Link text blocks with bubbles 
•	Update all linked bubbles automatically 
________________________________________
Layers Panel
Implement Photoshop-like Layers.
Support:
•	Groups 
•	Masks 
•	Adjustment Layers 
•	Lock 
•	Visibility 
•	Blend Modes 
•	Opacity 
•	Reordering 
•	Smart Objects 
________________________________________
Right Sidebar
Inspector panel.
Contains:
•	Properties 
•	Layers 
•	Objects 
•	AI Suggestions 
•	History 
•	Metadata 
•	Text 
•	Bubble Properties 
________________________________________
Additional Panels
Include:
•	Project Progress Indicator 
•	Memory Usage 
•	GPU Usage 
•	AI Queue 
•	Batch Processing 
•	Alignment Guides 
•	Rulers 
•	Grid Toggle 
•	Safe Area Overlay 
•	Full Screen Editing 
•	Navigator 
•	History 
•	Assets 
•	Fonts 
•	Brushes 
________________________________________
Music Player
Implement an integrated music player.
Support:
•	Local music 
•	Playlists 
•	Background playback 
•	YouTube playlist URL support 
•	Playback controls 
•	Volume 
•	Repeat 
•	Shuffle 
Fix any existing issues preventing YouTube playback.
________________________________________
File Support
Image Export:
•	PNG 
•	JPG 
•	WEBP 
•	PSD (preserving layers, editable text, fonts, guides, and effects) 
Text Export:
•	DOCX 
•	PDF 
•	TXT 
Project Save:
•	Native project format 
•	Auto Save 
•	Incremental versions 
________________________________________
Fonts
Support:
•	Install fonts 
•	Remove fonts 
•	Font manager 
•	Font preview 
•	Google Fonts integration (optional) 
________________________________________
Interactive Interface
Everything should be interactive.
Panels:
•	Dockable 
•	Collapsible 
•	Resizable 
•	Draggable 
No static placeholders.
Every button must perform its intended action.
________________________________________
Bug Fixes
Resolve all existing issues, including:
•	Uploaded images failing to open. 
•	Original page preview not displaying correctly. 
•	Original/cleaned page synchronization by page number. 
•	Inability to scroll properly inside the Studio. 
•	Inability to select text correctly. 
•	Multiple document support in the text editor. 
•	Broken project sections (Projects, Shared, Templates, Trash). 
•	Placeholder content appearing throughout the application. 
•	Spell checker not functioning. 
•	YouTube player failing to load or play. 
•	Imported assets not loading correctly. 
•	General UI inconsistencies and interaction bugs. 
________________________________________
Final Goal
Do not produce a mock-up or a visual concept only.
Redesign the application architecture, navigation, workflows, interface, interactions, and feature organization into a polished, fully interactive professional creative suite that feels comparable to Photoshop, Affinity Photo, Figma, DaVinci Resolve, and Microsoft Word while maintaining all existing functionality and significantly expanding it where appropriate.

