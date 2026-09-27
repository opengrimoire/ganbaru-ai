# Notes page covers

**Status: Implemented. Real desktop and Android visual and interaction acceptance remains required. Curated images are planned.**

## Design and color

Add cover opens a picker with **Designs** and **Upload**. Reopening selects the current cover's source and restores its choices.

| Design | Appearance |
| --- | --- |
| Solid | A quiet, flat field of color |
| Gradient | A smooth tonal transition |
| Contours | Fine flowing contour lines over a tonal field |
| Mosaic | Asymmetric geometric print with nested arcs, diagonal planes, hatching, and grain |
| Observatory | A shaded ringed planet, moon, and constellation connected by orbital light |
| Nature | A river valley with angular rock faces, forested banks, a winding river, and illustrated sky |
| Atlas | A shaded globe integrated with map contours, projection lines, and travel routes |
| Studio | A design table with construction drawings, a layered print, pigment studies, and drawing tools |
| Study | An annotated study spread with highlighted passages and a concept map |
| Mathematics | A coordinate surface connecting a curve, area shading, circle, and tangent construction |
| Programming | Indented code connected to execution paths on a field of circuit-like traces |
| Finance | A ledger whose rows continue into plotted trends and stacked columns |
| Dots | A restrained repeating dot pattern |
| Grid | Fine, evenly spaced lines |

Fourteen designs appear in two groups, Simple followed by Illustrations. Illustrations are ordered Study, Finance, Nature, Studio, Mathematics, Programming, Atlas, and Observatory. Simple includes Contours and Mosaic alongside Solid, Gradient, Dots, and Grid. Thumbnails use two columns with a fixed height and reflect the selected color using the same rendering and cropping rules as the banner. The scrolling catalog uses the same conditional 20px top and bottom edge fades as Add icon; fades update after scrolling, filtering, and resizing. Search and shuffle follow the Add icon toolbar. The picker reuses Add icon's color control, per-item color choice panel, and upload panel. Automatic uses the theme foreground; the other choices are the same 32 theme palette slots used by icons and Calendar. Ask every time opens color variations beside a selected design. Default color and Ask every time preferences are remembered independently for covers.

Designed covers retain their pattern and Automatic or palette-slot identity. Colors resolve against the active theme, with tonal variations derived from theme surfaces. Changing themes updates page covers, gallery cards, and history previews. Uploaded images retain their original colors. Titles remain below the banner.

Pattern density, angle, animation, independent secondary colors, and arbitrary color controls are outside the current scope. Static CSS and small inline SVG compositions render designs directly without generating image files or decoding raster thumbnails. They use no animation or blur filters. Designed covers do not subscribe to image sizing observers. Uploaded images reuse the existing bounded managed-asset cache.

The illustrated collection keeps its subjects recognizable. Science, the outdoors, geography, creative work, learning, mathematics, software, and finance guide the imagery. Shared trajectories, connected terrain and water, overlapping cartographic lines, and a common design-table surface connect the elements within each scene. Lighting, transparency, and scale establish depth. Contours and Mosaic provide abstract print compositions in Simple.

Scenes use a shallow 5:1 drawing canvas. Nature fills the entire banner with flat color layers for sky, distant terrain, rock faces, river, and foreground banks. Rock hatching and water lines add detail without a gradient background or gradient fills. Its composition adapts horizontally on desktop, with a central crop below 30rem to avoid squeezing narrow previews.

Other illustrated scenes scale to the banner height so subjects keep their proportions and remain visible vertically. Studio also renders a drafting grid, paper shapes, and pigment gestures across the full banner width. Study, Mathematics, Programming, and Finance use full-width ruled pages, coordinate grids, connected traces, and ledger rules respectively. Their foreground compositions retain proportions when the banner changes width. Mathematical notation and code punctuation are decorative, language-independent subject matter; picker names use the localized catalog. Narrow views crop the sides of the connected scene. Contours preserves its original 3:1 drawing canvas, tonal gradient, and centered fill crop. Its solid wave retains the curved upper edge and fills the area beneath it to the bottom of the banner. Mosaic fills the shallow banner and crops horizontally around its central composition below 30rem. Illustrated covers use shades of the selected theme color for contrast. Sizing uses CSS without resize listeners or per-frame work.

## Immediate selection

Without a cover, Add cover appears above the title. Existing covers instead show a compact Change and Reposition toolbar at the top right of the banner on hover or keyboard focus. On mobile, Add cover or Change cover is also available from Note actions in the header. Desktop buttons use compact sizing. Hover waits 280ms before a 180ms fade-in; leaving cancels a pending reveal or fades out from its current opacity in 90ms. Keyboard focus reveals the controls immediately. The toolbar stays visible while its panel is open and is always available with larger targets on touch devices. Change opens the picker; Reposition enables dragging the image directly within the banner. Designed covers only show Change. There is no download action.

Choosing a design or uploading an image immediately saves it and closes the picker. Changing the default color recolors an existing design immediately and leaves the picker open. Remove sits on the right side of the tab header, matching Add icon. There is no separate top preview, close button, or confirmation footer. Outside dismissal, Escape, and Android Back close the picker without reverting applied choices.

A failed save keeps the picker available with an error so the user can retry the selection. Saving disables repeated submission. Dismissing the picker or switching pages prevents a late file selection from updating a different page. Managed uploads use the existing ownership and cleanup lifecycle.

## Images and focal points

Upload supports the native desktop picker, mobile file input, and paste. Existing PNG, JPG, and WebP validation, byte limits, and dimension limits apply. Image failures remain visible and users can choose another image.

Reposition lets the user drag the existing banner image with a mouse, pen, or touch. The image follows the pointer and stops at its edges. Arrow keys move it in the same direction, Shift increases the step, and Home centers it. Save position and Cancel replace the cover toolbar during editing, with a compact, translucent drag hint centered over the image and no tooltip on the drag surface. During repositioning, a translated image layer previews the crop without changing object-position on every movement; the layer hint is removed outside editing. Pointer movements stay inside the cover and coalesce to one preview update per animation frame; releasing the pointer transfers the latest position to the editor draft. Tooltip-disabled surfaces skip scrollbar-tooltip layout checks. Movements update a local preview only; Save position persists the normalized source-image focal point once. Cancel, Escape, Android Back, and leaving the page discard an unsaved draft. A failed save preserves the draft with an error for retry. Save and Cancel are disabled during persistence. Unavailable or loading images cannot enter reposition mode. The upload picker no longer contains a separate focal-point editor.

Each filled renderer centers the saved subject where possible and clamps the crop to the image edges.

The original image bytes are retained. There is no destructive crop or resampling when position changes. Gallery cards retain their existing fit-image preference: focal points control filled previews, while fitted previews show the whole image.

## Responsive geometry

Banners follow the actual page container width, including side previews and tablet layouts. Their height derives from one fifth of that width, bounded between 8rem and 15rem, and capped at a quarter of the viewport height for short landscape layouts. This produces approximately 5:1 banners where the bounds do not apply and deeper crops on narrow screens. History previews use the same geometry.

There is no required upload aspect ratio or fixed generated-image resolution. A wide landscape source gives more crop flexibility. Uploaded source dimensions remain unchanged; generated designs render at the available size. The exact crop varies with the page or gallery container while retaining the focal point.

The picker uses the same anchored placement rules and panel width as Add icon. It stays within the visual viewport and follows scrolling, resizing, and software-keyboard changes. Its body scrolls when space is constrained. Escape returns keyboard focus to the trigger.

## Persistence and transfer

Designed covers have a validated design identifier and Automatic or palette slot. Image cover metadata may contain a normalized focal point. Generic block file objects remain distinct from this presentation metadata. No user-supplied CSS or SVG is stored as a designed cover.

The old generated-preset path is replaced directly without data migrations or legacy preset conversion. Existing external-format file variants remain part of the import contract. External Notes image reference capability is currently disabled on every platform, so the picker does not offer a URL tab.

Duplication, templates, history, and graph export preserve cover descriptors. History preserves palette identity, and rendering uses the viewer's current theme. Frontend and Rust boundaries validate pattern identifiers, palette bounds, finite focal coordinates, and managed asset references.

HTML and Markdown exports omit cover appearance and report `page_cover_omitted`. Graph export retains editable cover metadata. Rendering a static, theme-resolved cover into visual exports remains planned; the current exporters have no theme-rendering contract.

## Future curated collection

The planned collection uses CC0 images selected for flexible banner crops. Add **Collection** only when actual content exists. Each catalog entry should have a stable identifier, thumbnail, source dimensions, suggested focal point, descriptive text, and provenance/license information. Categories and search should appear only when the collection benefits from them.

Selecting a collection image should use the same immediate selection, focal positioning, and rendering workflow as Upload. The selected full-resolution image must be available locally so an existing cover works offline and survives catalog changes. Prefer a small bundled starter collection; consider optional downloads separately if package size makes a larger collection impractical. Opening Add cover must not trigger remote catalog loading.

No empty collection tab or catalog infrastructure is introduced in advance.

See [Pages and navigation](pages-and-navigation.md), [Import and export](import-export.md), and [History and recovery](history-and-recovery.md) for surrounding contracts.
