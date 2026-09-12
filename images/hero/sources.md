# Hero photographs (current-weather card)

Both files are photographs from Unsplash, cropped to 16:9 (1040 × 580) by the image CDN for the 420 × 235 CSS hero area (2× DPR). Free to use under the [Unsplash License](https://unsplash.com/license), checked 2026-09-13.

| Asset | Photographer | Source | Download |
| --- | --- | --- | --- |
| `sukhothai-sunset.jpg` (day) | Valeriy Ryasnyanskiy | https://unsplash.com/photos/OeGT6FQ0bYI — silhouette of the Buddha at Wat Mahathat, Sukhothai, at sunset | https://images.unsplash.com/photo-1584226660969-4d82d7f55049?fm=jpg&q=82&w=1040&h=580&fit=crop&crop=focalpoint&fp-x=0.5&fp-y=0.66 |
| `sukhothai-night.jpg` (night) | Peter Borter | https://unsplash.com/photos/oJXR4nJlxZI — Sukhothai Historical Park lit at night | https://images.unsplash.com/photo-1599576836593-3cc8d8ef3087?fm=jpg&q=82&w=1040&h=580&fit=crop&crop=focalpoint&fp-x=0.5&fp-y=0.45 |

`style.css` cross-fades to the night photo when the current card reports `data-condition="night"` and darkens/desaturates either photo for rain, storm, cloud and fog; stars and rain streaks are drawn by the small inline SVG overlay in `index.html`.
