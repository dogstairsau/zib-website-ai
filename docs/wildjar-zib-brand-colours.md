# WildJar dashboard — Zib Digital colour mapping

Values for the WildJar **Customisation** screen (ZIB HOLDINGS PTY LTD account), mapped
from the Zib Digital design tokens in `assets/base.css`.

## Colours

| WildJar field       | WildJar default | Zib Digital | Token / reason |
| ------------------- | --------------- | ----------- | -------------- |
| Primary             | `#5d78ff`       | `#FF6200`   | `--accent` — Zib orange, the single brand colour |
| Secondary           | `#ffa709`       | `#FF9D00`   | `--score-mid` — amber, keeps the warning / second-accent role |
| Accent              | `#82B1FF`       | `#FF8A3D`   | Lighter orange; same relationship `#82B1FF` has to WildJar's blue |
| Blue                | `#5d78ff`       | `#FF6200`   | WildJar sets Blue = Primary; mirrored |
| Dark                | `#333333`       | `#1A1A1A`   | `--ink-3` |
| Error               | `#fd397a`       | `#E03A3A`   | `--score-bad` |
| Info                | `#5d78ff`       | `#FF6200`   | WildJar sets Info = Primary; mirrored |
| Success             | `#0abb87`       | `#0BAB6E`   | `--score-good` |
| Main background     | `#FFFFFF`       | `#FFFFFF`   | `--bg` |
| Alt background      | `#f2f3f8`       | `#FAFAF8`   | `--paper` — warm off-white instead of the blue-grey |
| Menu background     | `#1e1e2d`       | `#0F0F0F`   | `--ink-2` — neutral black sidebar, no blue cast |
| Menu item active bg | `#1b1b28`       | `#1A1A1A`   | `--ink-3` — subtle lift off the sidebar |
| Menu item text      | `#FFFFFF`       | `#FFFFFF`   | Unchanged |
| Border              | `#dbdbdb`       | `#E8E5DD`   | `--rule` — warm hairline, matches zibdigital.com.au |
| Text colour         | `#595d6e`       | `#1A1A1A`   | `--ink-3` — Zib body text is near-black, not blue-grey |
| Answered call       | *(empty)*       | `#0BAB6E`   | Reuses Success |
| Missed call         | *(empty)*       | `#E03A3A`   | Reuses Error |
| Abandoned call      | *(empty)*       | `#FF9D00`   | Reuses Secondary |

## Notes

- **Blue and Info both resolve to orange** because WildJar's own config points them at
  Primary. If either feeds chart series, override with something neutral against the
  orange — `#1F3A47` (deep teal-navy) for Blue and `#6B6B6B` (`--muted`) for Info.
- **Accent `#FF8A3D` is derived**, not a documented Zib token. The documented tint
  `--accent-tint` `#FFE8D9` is too pale for anything but background fills.
- Contrast: `#FF6200` on white is 3.4:1 — fine for large text, icons, and UI chrome, but
  not for small body copy. Keep body text on `#1A1A1A`.

## Source tokens (`assets/base.css`)

```
--bg: #FFFFFF;          --paper: #FAFAF8;       --ink: #000000;
--ink-2: #0F0F0F;       --ink-3: #1A1A1A;       --muted: #6B6B6B;
--muted-2: #9C9C9C;     --rule: #E8E5DD;        --rule-2: #D4D0C4;
--accent: #FF6200;      --accent-tint: #FFE8D9; --dim: #F5F2EB;
--score-good: #0BAB6E;  --score-mid: #FF9D00;   --score-bad: #E03A3A;
```
