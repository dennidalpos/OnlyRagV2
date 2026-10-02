# Tabular fixtures

`ragged.xls` is the genuine BIFF workbook from the [xlrd test corpus](https://github.com/python-excel/xlrd/blob/60c4cff7b003234ea88fe933cf98a86588e830fb/tests/samples/ragged.xls), revision `60c4cff7b003234ea88fe933cf98a86588e830fb`.
SHA256: `a144c284163641c2cb7dfc17d0116006aeffc3dff2b4878f039d4dbab6e2b07e`.
Its BSD license is retained in `xlrd-LICENSE.txt`.

Sheet1 contains the source rows `a,b,c`, `d,e`, `f`, `g,h,I,j`, and `k,,,l`; Sheet2 and Sheet3 are empty. Tests assert first and last rows as well as trailing cells.
XLSX fixtures are generated with openpyxl in pytest temporary directories. Expected cells include leading-zero codes, numeric amounts, literal `NA`, a second sheet, and a single-cell workbook. No fixture needs Microsoft Excel or a live model.
