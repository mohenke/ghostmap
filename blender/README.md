# Blender-steget i GHOST PULSE

Här förvandlas Mapforges stadsmodell av Haga till en kusligare version i Blender.
Resultatet läses in av webbappen i Ghost Mode (lagret **Blender-modell** i panelen).

```
Mapforge (Ghost Mode → Export GLB)
   └─ blender/haga-mapforge-export.glb
        └─ Blender: ghostify_haga.py
             ├─ blender/haga-ghost.blend        (öppna i Blender för att titta/finjustera)
             └─ public/models/haga-ghost.glb    (läses in av webbappen)
```

## Vad skriptet gör

1. **Importerar** Mapforges GLB med sluttande tak, gatsten och färger per hus.
2. **Behåller positioner och proportioner**: inget flyttas eller skalas.
3. **Nya material**: mörka byggnader med individuell nyans per hus (färgattribut),
   nattfärgade gator, parker och vatten.
4. **Upplysta fönster**: ca 1 350 små självlysande fönster, mest varmt orange
   och några kusligt lila eller cyan.
5. **Slår ihop allt per material**: över 1 000 objekt blir 9, vilket ger mycket
   snabbare visning i webbläsaren.
6. **Dekorationer**: Halloween-pumpor längs Haga Nygata och mätmaster under varje sensor.
   Gatlyktor och träd skapas inte här. Webbappen ritar de riktiga från OpenStreetMap
   (304 lyktor, 715 träd och alléer) ovanpå modellen.
7. **Namngivna sensorpositioner**: tomma objekt med namnen `SENSOR_GP-01` …
   `SENSOR_GP-06`. Webbappen läser dem och placerar sensorerna där.

## Terräng

Webbappen ställer husen på markhöjden och lägger ut gator och parker över terrängen innan
exporten. Blender-modellen följer därför redan terrängen. Skriptet läser samma höjdrutnät
(`public/data/haga-terrain.json`) och räknar markhöjden exakt som webbappen, så att mätmaster,
pumpor och sensorn på gatan hamnar rätt.

Modellen exporteras med **Draco-komprimering** (14 MB → ca 1,8 MB). Avkodaren ligger lokalt i
`public/draco/` (kopierad från Three.js), så inget hämtas från någon CDN.

## Köra om

Från mappen `mapforge`:

```bash
python3 scripts/make_terrain.py              # höjdrutnät från öppna höjddata → public/data/haga-terrain.json
python3 blender/make_decor_input.py          # gator, parker och sensorer → decor-input.json
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python blender/ghostify_haga.py
```

Det tar några sekunder och kräver inte att Blender är öppet. Skriptet utgår från en GLB som
exporterats i **Ghost Mode**, eftersom det känner igen Mapforges material på deras färger.

## Koordinater, skala och kompatibilitet

- **Koordinatsystem:** Three.js har Y uppåt och Blender har Z uppåt. glTF-importen och
  glTF-exporten konverterar automatiskt åt båda hållen.
- **Verifierat:** sensorpositionerna från Blender skiljer sig 0,000 enheter från de
  positioner webbappen själv räknar fram.
- **Skala:** 1 enhet ≈ 2,18 m (Mapforges projektion, 51 000 enheter per breddgrad).
- **Material:** bara Principled BSDF-värden som glTF kan bära används (basfärg,
  färgattribut, roughness, emission med `KHR_materials_emissive_strength`).
  Procedurella Blender-texturer används inte, eftersom de inte följer med till webben.
- **Blender-version:** testat med Blender 5.1.1. Mapforges README varnar för importproblem
  i 5.x, men just dessa filer importeras och exporteras utan fel.

## Via MCP

Första versionen gjordes interaktivt av Claude Code via Blender-MCP: import, kontroll av
material och koordinater, testrenderingar. Stegen samlades sedan i `ghostify_haga.py` så att de
går att upprepa. Ett MCP-anrop som bytte aktiv scen under exporten fick Blender att krascha.
Exporten körs därför i bakgrundsläge med skriptet ovan.
