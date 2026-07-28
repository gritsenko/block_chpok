# Промпт для генерации атласа иконок (Nano Banana / Gemini Image)

Цель — одним изображением получить все 19 иконок интерфейса приключения, чтобы потом
нарезать их на файлы из таблицы в [ADVENTURE_MODE.md](ADVENTURE_MODE.md#6-иконки-спрайты).

## Как этим пользоваться

1. Открыть Gemini (Nano Banana / Nano Banana Pro) или AI Studio, **соотношение сторон 1:1**,
   разрешение — максимальное доступное (2K, лучше 4K).
2. Вставить промпт из блока ниже **целиком, без изменений**.
3. Получить PNG-атлас: сетка **5 колонок × 4 ряда**, фон — заливка `#FF00FF`.
4. Нарезать по сетке и выбить фон (Nano Banana не умеет альфа-канал, поэтому просим
   чистую мадженту — она не встречается в палитре игры и снимается в один клик).
5. Сохранить с именами и размерами из таблицы «Раскладка атласа» ниже.

**Почему маджента, а не прозрачность:** модель всегда отдаёт непрозрачный PNG. Ключевание
по `#FF00FF` даёт чистые края; белый или зелёный фон конфликтует с бликами и с зелёным
блоком.

---

## Промпт (копировать как есть)

```text
Create ONE single square image: a sprite atlas of 19 game UI icons for a casual mobile
block-puzzle game, laid out on a strict 5-column by 4-row grid (20 equal square cells,
numbered 1-20 left to right, top to bottom).

ART STYLE (apply identically to every icon):
Hand-painted 2D cartoon game art in the style of premium casual mobile puzzle games.
Each icon is a chunky, semi-glossy object with a thick dark brown near-black outline,
smooth interior gradients, a crisp white specular highlight in the upper-left, and gentle
darker shading along the lower-right edge. Light comes from the top-left, consistently for
all icons. Straight-on front view, no perspective, no isometric angle, no tilt.
Warm storybook palette: wood brown #7A4A24 to #9B6134, gold #F6A623 to #FFD24A,
cream #F6D6A3, glossy candy blue #1E8FE0, deep red #B03A3A.
Silhouettes must be bold and simple, with very little internal detail, because these icons
will be displayed as small as 16 pixels. Readability at tiny size beats detail everywhere.

LAYOUT RULES:
- Pure flat solid magenta background #FF00FF, absolutely uniform, filling the whole canvas
  and every gap between icons.
- No visible grid lines, no cell borders, no frames, no plates, no badges, no circles
  behind the icons, no captions, no labels, no watermark.
- Every icon is centered in its own cell and fills about 78% of the cell width, with clear
  magenta padding around it. Icons never touch each other and never touch a cell edge.
- All icons share the same visual weight, the same outline thickness, and the same apparent
  scale, as if drawn by one artist in one sitting for one icon set.
- No drop shadow or glow spilling onto the magenta background. Shading stays inside the
  icon's own outline.

CELL CONTENTS (exact order):
1. A neat stack of three shiny gold coins with a bright star-shaped sparkle on top.
2. One horizontal row of four glossy rounded blocks lit up bright, with a white energy
   flash sweeping across the row as it clears.
3. A tight cluster of three glossy rounded blocks in blue, green and red, breaking apart
   with two or three small chips flying off.
4. A wooden shipping crate made of planks, with dark iron nails in the corners.
5. A translucent pale blue ice cube with frost on its surface and a crack running through it.
6. A faceted cut crystal gem in violet-purple, sharp facets, bright glint on one facet.
7. A round black cartoon bomb with a short curved fuse and a small orange flame on the tip.
8. A bright orange-yellow flame burst with two small spark trails curving upward around it.
9. An L-shaped puzzle piece built from three glossy orange blocks, with a small gold
   downward arrow just below it.
10. Three glossy rounded blocks in red, blue and green, fanned out and overlapping each
    other like a hand of cards.
11. A single thick clockwise circular arrow in glossy candy blue with a gold arrowhead.
12. A plump glossy red heart, classic shape, bright white highlight in the upper left.
13. A closed padlock: dark wooden body with a keyhole, thick polished brass shackle on top.
14. A golden two-handled trophy cup on a short brown wooden base, with a bright shine
    across the bowl.
15. A simple generic user avatar: a soft cream-beige silhouette of a head and shoulders on a
    warm neutral grey-brown rounded background.
16. A cartoon wooden mallet with a chunky head banded in gold, held diagonally, one small
    white sparkle near the head.
17. Two curved arrows in glossy candy blue crossing over each other above two small
    glossy blocks, indicating a shuffle.
18. A glossy five-pointed star in bright gold with a warm inner glow and a darker gold rim.
19. The exact same five-pointed star as in cell 18 — identical shape, identical size,
    identical position and identical outline — but unlit: desaturated warm grey-beige,
    matte, no glow, no gold. It must be a perfect drop-in replacement for cell 18.
20. Empty. Magenta background only, nothing drawn here.

CRITICAL CONSTRAINTS:
- Absolutely no text, no letters, no numbers, no digits, no cell numbering anywhere in the
  image. The numbers above describe positions only, they must never be rendered.
- Exactly 19 icons and one empty cell. Do not add extra objects, decorations, characters
  or filler art.
- Cells 18 and 19 must be pixel-aligned twins of the same star, differing only in color
  and lighting.
- Keep the background one single flat magenta tone with no gradient, texture or vignette.
```

---

## Раскладка атласа → файлы

Нумерация ячеек: слева-направо, сверху-вниз. Размер — итоговый PNG после нарезки.

| # | Файл | Размер | Что на иконке |
|---|---|---|---|
| 1 | `icon-goal-score.png` | 48×48 | столбик золотых монет |
| 2 | `icon-goal-lines.png` | 48×48 | ряд блоков со вспышкой |
| 3 | `icon-goal-blocks.png` | 48×48 | распадающиеся блоки |
| 4 | `icon-goal-crate.png` | 48×48 | деревянный ящик |
| 5 | `icon-goal-ice.png` | 48×48 | треснувший лёд |
| 6 | `icon-goal-gem.png` | 48×48 | кристалл |
| 7 | `icon-goal-bomb.png` | 48×48 | бомба |
| 8 | `icon-goal-combo.png` | 48×48 | огненная вспышка |
| 9 | `icon-goal-placements.png` | 48×48 | L-фигура со стрелкой |
| 10 | `icon-goal-color.png` | 48×48 | три цветных блока веером |
| 11 | `icon-moves.png` | 48×48 | круговая стрелка |
| 12 | `icon-heart.png` | 48×48 | сердце |
| 13 | `icon-lock.png` | 72×72 | замок |
| 14 | `icon-trophy.png` | 72×72 | кубок |
| 15 | `icon-avatar-placeholder.png` | 96×96 | силуэт игрока |
| 16 | `icon-booster-hammer.png` | 96×96 | молоток |
| 17 | `icon-booster-shuffle.png` | 96×96 | перемешать |
| 18 | `icon-star-filled.png` | 128×128 | звезда золотая |
| 19 | `icon-star-empty.png` | 128×128 | звезда серая |
| 20 | — | — | пустая ячейка |

Порядок в атласе намеренно не совпадает с порядком в `ICONS` из
`scripts/make-icon-placeholders.mjs`: иконки сгруппированы по смыслу (цели → HUD → карта →
бустеры → звёзды), чтобы модель держала единый стиль внутри ряда.

---

## Перегенерация одной иконки

Атлас почти никогда не выходит идеальным с первого раза. Вместо повторной генерации всего
листа — приложить полученный атлас как входное изображение и попросить точечную правку
(Nano Banana хорошо держит остальную картинку без изменений):

```text
Here is my icon atlas. Keep the entire image pixel-identical except for cell N
(row R, column C, counting from the top-left). Redraw only that cell: <новое описание>.
Match the existing art style, outline thickness, lighting direction and icon scale exactly.
Keep the flat magenta #FF00FF background. No text anywhere.
```

## Чего ждать и что чинить руками

- **Размер.** Даже 4K-атлас даёт ~800 px на ячейку — этого хватает с запасом на 128×128.
  При нарезке уменьшать с ресемплингом (Lanczos), а не обрезать.
- **Сетка «плывёт».** Модель редко попадает в идеально равные ячейки. Нарезать по факту, а
  не по формуле: найти bbox каждой иконки и обрезать по нему с одинаковым отступом.
- **Звёзды.** Ячейки 18 и 19 обязательно проверить наложением: если силуэты не совпадают,
  проще сделать серую звезду из золотой обесцвечиванием в редакторе, чем перегенерировать.
- **Контур на маджентовом фоне** даёт розовую окантовку после ключевания — убирать
  «сжатием» альфы на 1–2 px (defringe / decontaminate colors).
- Оптимизировать финальные PNG (`pngquant`/`oxipng`) — иконки уходят в zip для Яндекса,
  а он ограничен по размеру.
