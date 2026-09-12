# Sunny and cloudy weather photographs

Retrieved 2026-09-13. Production files are downloaded photographs, not AI-generated images. Both final JPEG files were decoded locally and verified as 3840 × 2160 pixels. Source sizes were verified using the image CDN's `fm=json` metadata (`PixelWidth` / `PixelHeight`). The CDN crops and downsizes these larger originals; neither selected file is upscaled.

## Sunny

- File: `sunny-4k.jpg`
- Photographer: Bernd Dittrich
- Source: https://unsplash.com/photos/a-field-of-tall-grass-with-the-sun-in-the-background-UVfF-uugU9k
- Original dimensions: 8192 × 2996 pixels
- Download: https://images.unsplash.com/photo-1717735418404-a895a19800b6?fm=jpg&fit=crop&w=3840&h=2160&q=92
- Original metadata: https://images.unsplash.com/photo-1717735418404-a895a19800b6?fm=json
- License: Unsplash License, https://unsplash.com/license
- Visual inspection: clear blue sky with visible sunlight above a green wheat field. Sun is around 18% across the frame; use left-biased positioning for portrait crops.

## Cloudy

- File: `cloudy-4k.jpg`
- Photographer: Tobias Siebenlist
- Source: https://unsplash.com/photos/green-grass-field-under-cloudy-sky-during-daytime-q6zIaO-EmIE
- Original dimensions: 4032 × 3024 pixels
- Download: https://images.unsplash.com/photo-1588419692425-1f5bb1d54791?fm=jpg&fit=crop&w=3840&h=2160&q=92
- Original metadata: https://images.unsplash.com/photo-1588419692425-1f5bb1d54791?fm=json
- License: Unsplash License, https://unsplash.com/license
- Visual inspection: gray cloud layers above a green countryside field, no sun disk or lightning. Central crop retains the cloudy sky.

## Unselected trials

The built-in image generation tool was tried with prompts requesting 3840 × 2160. It returned 1672 × 941 images, which were not selected because they do not meet the requested 4K resolution. No CLI/API image generation fallback or upscaling was used. Generated trials remain at the tool's original destination, outside the project, and are not referenced by the app. Prompt records are in `sun-cloud-prompts.md`.

An initial cloudy photograph by Nick Fewings (`photo-1653077447727-4c5d8f8f0141`) was rejected after checking its 3032 × 2021 original size. It is not the final `cloudy-4k.jpg`.
