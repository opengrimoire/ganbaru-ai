# Notes page covers

**Status: Implemented. Real desktop and Android visual and interaction acceptance remains required. Curated images are planned.**

## Design and color

Add cover opens a picker with **Designs** and **Upload**. Reopening selects the current cover's source and restores its choices.

| Design | Appearance |
| --- | --- |
| Solid | A quiet, flat field of color |
| Gradient | A smooth tonal transition |
| Glow | Soft overlapping pools of color |
| Contours | Fine flowing contour lines over a tonal field |
| Ribbons | Layered flowing bands with shaded edges |
| Landscape | Layered hills, a sun, and horizon details |
| Orbit | Shaded spheres and elliptical orbital lines |
| Dots | A restrained repeating dot pattern |
| Grid | Fine, evenly spaced lines |

Nine designs appear in two compact groups, Illustrations and Simple. Their thumbnails reflect the selected color and share the banner's rendering rules. Search and shuffle follow the Add icon toolbar. The picker reuses Add icon's color control, per-item color choice panel, and upload panel. Automatic uses the theme foreground; the other choices are the same 32 theme palette slots used by icons and Calendar. Ask every time opens color variations beside a selected design. Default color and Ask every time preferences are remembered independently for covers.

Designed covers retain their pattern and Automatic or palette-slot identity. Colors resolve against the active theme, with tonal variations derived from theme surfaces. Changing themes updates page covers, gallery cards, and history previews. Uploaded images retain their original colors. Titles remain below the banner.

Pattern density, angle, animation, independent secondary colors, and arbitrary color controls are outside the current scope. Static CSS and small inline SVG compositions render designs directly without generating image files or decoding raster thumbnails. They use no animation or blur filters. Designed covers do not subscribe to image sizing observers. Uploaded images reuse the existing bounded managed-asset cache.

## Immediate selection

Choosing a design or uploading an image immediately saves it and closes the picker. Changing the default color recolors an existing design immediately and leaves the picker open. Remove sits on the right side of the tab header, matching Add icon. There is no separate top preview, close button, or confirmation footer. Outside dismissal, Escape, and Android Back close the picker without reverting applied choices.

A failed save keeps the picker available with an error so the user can retry the selection. Saving disables repeated submission. Dismissing the picker or switching pages prevents a late file selection from updating a different page. Managed uploads use the existing ownership and cleanup lifecycle.

## Images and focal points

Upload supports the native desktop picker, mobile file input, paste. Existing PNG, JPG, and WebP validation, byte limits, and dimension limits apply. Image failures remain visible and users can choose another image.

Reposition opens a view of the entire source image. Select the subject to keep visible by clicking or tapping. Arrow keys adjust its position, Shift increases the step, and Home or Reset position centers it. Each position change immediately saves normalized source-image coordinates. Rapid changes are serialized and retain the latest requested position. Each filled renderer centers that subject where possible and clamps the crop to the image edges.

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
