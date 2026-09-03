# Origin

`branchling` was built inside a private repository as the module that drove its
backlog, and was extracted from it on 2026-08-30. **The history was deliberately
flattened to a single commit** — the earlier commits mixed the tool's code with
changes to somebody else's private data, so they could not be carried across
whole, and carrying part of them would have produced a history that lies by
omission.

**It was flattened a second time on 2026-09-01**, before publication and while
the repository still had no remote. The 97 commits of that period were written
in Polish, and the language rule they themselves established had no way to reach
them: a commit message cannot be checked before it is written or corrected
after. Squashing was the only moment that would ever be cheap, because nothing
had been published and no hash was in anybody's hands.

Both flattenings cost the same thing — the order in which decisions were made
and the reasoning attached to each one — which is why this file exists, and why
that reasoning is kept where a rewrite of the history cannot reach it.

## Where the reasoning lives

Not in `git log`. In two places that travel with the code:

- **`docs/`** — seven architecture documents. Each describes one decision, its
  mechanism, and what would refute it.
- **`backlog/tasks/`** — this tool's own tasks; `branchling stats` counts them,
  and a number written here would be stale by the next commit. This is its real
  development history: what was done, in what order, and what was deliberately
  left alone. The tool tracks itself with itself.

## Milestones

Ids carry both identities: the number they had before the extraction renamed
`BL` to `TL`, and the number they carry today after the 2026-09-01 renumbering.

| Task | Decision |
|---|---|
| BL-1380 → TL-9 | **Boards as a partition** of the backlog — a closed vocabulary, exactly one board per task |
| BL-1385 → TL-12 | `INDEX.yaml` is an index, not a copy of the tasks |
| BL-1386 → TL-13 | `NOW.yaml` is COMPUTED from the statuses — there is no field to set |
| BL-1388 → TL-14 | `query` instead of reading the views — a question, not a file |
| BL-1390 → TL-15 | Filter state in the URL, so a set of tasks can be sent to somebody |
| BL-1396 → TL-16 / BL-1397 → TL-17 | Editing every field in the viewer, plus **a change history with an author** |
| BL-1399 → TL-18 | **The data directory is an ARGUMENT**, not a property of where the code sits |
| BL-1400 → TL-19 | **The code knows the SHAPE, the configuration knows the VALUES** — vocabularies into `config.yaml` |
| BL-1404 → TL-21 | The foundation of the **event log**: ULID, actor namespaces, views outside git |
| BL-1411 → TL-22 | One entry point (`branchling`), and an unknown command FAILS |
| BL-1412 → TL-23 / BL-1413 → TL-24 | `init` and `new` — creating a backlog and creating tasks |
| BL-1417 → TL-25 | Flag validation: a typo fails instead of passing silently |
| BL-1439 → TL-33 | **An installable package** — `package.json`, `bin/`, the name from one constant |
| `origin#BL-1445` | The extraction into this repository |
| `origin#BL-1446` | The consumer repointed at the installed package; its `backlog/` is now data only |

## The principle that survived all of those decisions

**What is computed may be deleted.** Views, indexes, aggregates — each of them
is reproduced by a command. If deleting something hurts, it has stopped being
computed and started being a truth; the error is then in the design, not in the
person who deleted it.

## Number redirects — the 2026-09-01 renumbering (TL-135)

The numbering used to start at `TL-1303`, because the tool was a module of
another workspace and was extracted from it; the lower numbers belonged to the
consumer and did not travel. On 2026-09-01 the backlog was renumbered to a
contiguous `TL-1`..`TL-135`.

**This table outlived the reason it was written for.** It was added because 62
commits carried an old number in their titles and `git log` could not be
corrected; the squash later that day removed those commits, so that particular
danger is gone. The table stays because two other readers still need it: the 192
`BL-*` markers across 50 files in `scripts/`, which were deliberately left as a
trace of origin rather than repointed, and anyone holding a clone from before
either rewrite. An old number does not lead nowhere — it names a DIFFERENT task,
which is the failure mode that reads as success.

The key is the NUMBER, not the prefix: the same pairs resolve `BL-1404` from
before the extraction and `TL-1404` from before the renumbering. The `BL-*`
markers in `scripts/` (192 occurrences across 50 files) were deliberately left
untouched — they are a trace of origin, not a reference the tool is entitled to
repoint.

The full map is DATA, not only text: `backlog/history/.migrations.jsonl`, the
record with `kind: "renumber"`. That is where every other clone reads it from.

```
1303→1     1304→2     1314→3     1315→4     1318→5     1319→6
1321→7     1322→8     1380→9     1382→10    1383→11    1385→12
1386→13    1388→14    1390→15    1396→16    1397→17    1399→18
1400→19    1402→20    1404→21    1411→22    1412→23    1413→24
1417→25    1418→26    1424→27    1425→28    1426→29    1427→30
1429→31    1430→32    1439→33    1440→34    1441→35    1442→36
1447→37    1448→38    1449→39    1450→40    1451→41    1452→42
1453→43    1454→44    1455→45    1456→46    1457→47    1458→48
1459→49    1460→50    1461→51    1462→52    1463→53    1464→54
1465→55    1466→56    1467→57    1468→58    1469→59    1470→60
1471→61    1472→62    1473→63    1474→64    1475→65    1476→66
1477→67    1478→68    1479→69    1480→70    1481→71    1482→72
1483→73    1484→74    1485→75    1486→76    1487→77    1488→78
1489→79    1490→80    1491→81    1492→82    1493→83    1494→84
1495→85    1496→86    1497→87    1498→88    1499→89    1500→90
1501→91    1502→92    1503→93    1504→94    1505→95    1506→96
1507→97    1508→98    1509→99    1510→100   1511→101   1512→102
1513→103   1514→104   1515→105   1516→106   1517→107   1518→108
1519→109   1520→110   1521→111   1522→112   1523→113   1524→114
1525→115   1526→116   1527→117   1528→118   1529→119   1530→120
1531→121   1532→122   1533→123   1534→124   1535→125   1536→126
1537→127   1538→128   1539→129   1540→130   1541→131   1542→132
1543→133   1544→134   1545→135
```
