Noto Sans Regular/Bold (SIL Open Font License 1.1, see OFL.txt), from @expo-google-fonts/noto-sans 0.4.2.
Subset to Latin, Latin-1, Latin Extended-A (Turkish), punctuation, € and ₺ with:

    python3 -m fontTools.subset NotoSans-<Weight>.ttf \
      --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,U+2010-2027,U+2030-203A,U+20AC,U+20BA,U+2122,U+2190-2193,U+2022" \
      --layout-features='kern'   # no ligatures: pdf-lib cannot map them back to text

Used by the proposal PDF (apps/web/src/proposals/pdf.ts).
