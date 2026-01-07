// src/main.ts
var {execSync: execSync2, spawn} = (() => ({}));

// node:path
function assertPath(path) {
  if (typeof path !== "string")
    throw TypeError("Path must be a string. Received " + JSON.stringify(path));
}
function normalizeStringPosix(path, allowAboveRoot) {
  var res = "", lastSegmentLength = 0, lastSlash = -1, dots = 0, code;
  for (var i = 0;i <= path.length; ++i) {
    if (i < path.length)
      code = path.charCodeAt(i);
    else if (code === 47)
      break;
    else
      code = 47;
    if (code === 47) {
      if (lastSlash === i - 1 || dots === 1)
        ;
      else if (lastSlash !== i - 1 && dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 || res.charCodeAt(res.length - 2) !== 46) {
          if (res.length > 2) {
            var lastSlashIndex = res.lastIndexOf("/");
            if (lastSlashIndex !== res.length - 1) {
              if (lastSlashIndex === -1)
                res = "", lastSegmentLength = 0;
              else
                res = res.slice(0, lastSlashIndex), lastSegmentLength = res.length - 1 - res.lastIndexOf("/");
              lastSlash = i, dots = 0;
              continue;
            }
          } else if (res.length === 2 || res.length === 1) {
            res = "", lastSegmentLength = 0, lastSlash = i, dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          if (res.length > 0)
            res += "/..";
          else
            res = "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0)
          res += "/" + path.slice(lastSlash + 1, i);
        else
          res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i, dots = 0;
    } else if (code === 46 && dots !== -1)
      ++dots;
    else
      dots = -1;
  }
  return res;
}
function _format(sep, pathObject) {
  var dir = pathObject.dir || pathObject.root, base = pathObject.base || (pathObject.name || "") + (pathObject.ext || "");
  if (!dir)
    return base;
  if (dir === pathObject.root)
    return dir + base;
  return dir + sep + base;
}
function resolve() {
  var resolvedPath = "", resolvedAbsolute = false, cwd;
  for (var i = arguments.length - 1;i >= -1 && !resolvedAbsolute; i--) {
    var path;
    if (i >= 0)
      path = arguments[i];
    else {
      if (cwd === undefined)
        cwd = process.cwd();
      path = cwd;
    }
    if (assertPath(path), path.length === 0)
      continue;
    resolvedPath = path + "/" + resolvedPath, resolvedAbsolute = path.charCodeAt(0) === 47;
  }
  if (resolvedPath = normalizeStringPosix(resolvedPath, !resolvedAbsolute), resolvedAbsolute)
    if (resolvedPath.length > 0)
      return "/" + resolvedPath;
    else
      return "/";
  else if (resolvedPath.length > 0)
    return resolvedPath;
  else
    return ".";
}
function normalize(path) {
  if (assertPath(path), path.length === 0)
    return ".";
  var isAbsolute = path.charCodeAt(0) === 47, trailingSeparator = path.charCodeAt(path.length - 1) === 47;
  if (path = normalizeStringPosix(path, !isAbsolute), path.length === 0 && !isAbsolute)
    path = ".";
  if (path.length > 0 && trailingSeparator)
    path += "/";
  if (isAbsolute)
    return "/" + path;
  return path;
}
function isAbsolute(path) {
  return assertPath(path), path.length > 0 && path.charCodeAt(0) === 47;
}
function join() {
  if (arguments.length === 0)
    return ".";
  var joined;
  for (var i = 0;i < arguments.length; ++i) {
    var arg = arguments[i];
    if (assertPath(arg), arg.length > 0)
      if (joined === undefined)
        joined = arg;
      else
        joined += "/" + arg;
  }
  if (joined === undefined)
    return ".";
  return normalize(joined);
}
function relative(from, to) {
  if (assertPath(from), assertPath(to), from === to)
    return "";
  if (from = resolve(from), to = resolve(to), from === to)
    return "";
  var fromStart = 1;
  for (;fromStart < from.length; ++fromStart)
    if (from.charCodeAt(fromStart) !== 47)
      break;
  var fromEnd = from.length, fromLen = fromEnd - fromStart, toStart = 1;
  for (;toStart < to.length; ++toStart)
    if (to.charCodeAt(toStart) !== 47)
      break;
  var toEnd = to.length, toLen = toEnd - toStart, length = fromLen < toLen ? fromLen : toLen, lastCommonSep = -1, i = 0;
  for (;i <= length; ++i) {
    if (i === length) {
      if (toLen > length) {
        if (to.charCodeAt(toStart + i) === 47)
          return to.slice(toStart + i + 1);
        else if (i === 0)
          return to.slice(toStart + i);
      } else if (fromLen > length) {
        if (from.charCodeAt(fromStart + i) === 47)
          lastCommonSep = i;
        else if (i === 0)
          lastCommonSep = 0;
      }
      break;
    }
    var fromCode = from.charCodeAt(fromStart + i), toCode = to.charCodeAt(toStart + i);
    if (fromCode !== toCode)
      break;
    else if (fromCode === 47)
      lastCommonSep = i;
  }
  var out = "";
  for (i = fromStart + lastCommonSep + 1;i <= fromEnd; ++i)
    if (i === fromEnd || from.charCodeAt(i) === 47)
      if (out.length === 0)
        out += "..";
      else
        out += "/..";
  if (out.length > 0)
    return out + to.slice(toStart + lastCommonSep);
  else {
    if (toStart += lastCommonSep, to.charCodeAt(toStart) === 47)
      ++toStart;
    return to.slice(toStart);
  }
}
function _makeLong(path) {
  return path;
}
function dirname(path) {
  if (assertPath(path), path.length === 0)
    return ".";
  var code = path.charCodeAt(0), hasRoot = code === 47, end = -1, matchedSlash = true;
  for (var i = path.length - 1;i >= 1; --i)
    if (code = path.charCodeAt(i), code === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else
      matchedSlash = false;
  if (end === -1)
    return hasRoot ? "/" : ".";
  if (hasRoot && end === 1)
    return "//";
  return path.slice(0, end);
}
function basename(path, ext) {
  if (ext !== undefined && typeof ext !== "string")
    throw TypeError('"ext" argument must be a string');
  assertPath(path);
  var start = 0, end = -1, matchedSlash = true, i;
  if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
    if (ext.length === path.length && ext === path)
      return "";
    var extIdx = ext.length - 1, firstNonSlashEnd = -1;
    for (i = path.length - 1;i >= 0; --i) {
      var code = path.charCodeAt(i);
      if (code === 47) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (firstNonSlashEnd === -1)
          matchedSlash = false, firstNonSlashEnd = i + 1;
        if (extIdx >= 0)
          if (code === ext.charCodeAt(extIdx)) {
            if (--extIdx === -1)
              end = i;
          } else
            extIdx = -1, end = firstNonSlashEnd;
      }
    }
    if (start === end)
      end = firstNonSlashEnd;
    else if (end === -1)
      end = path.length;
    return path.slice(start, end);
  } else {
    for (i = path.length - 1;i >= 0; --i)
      if (path.charCodeAt(i) === 47) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else if (end === -1)
        matchedSlash = false, end = i + 1;
    if (end === -1)
      return "";
    return path.slice(start, end);
  }
}
function extname(path) {
  assertPath(path);
  var startDot = -1, startPart = 0, end = -1, matchedSlash = true, preDotState = 0;
  for (var i = path.length - 1;i >= 0; --i) {
    var code = path.charCodeAt(i);
    if (code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1)
      matchedSlash = false, end = i + 1;
    if (code === 46) {
      if (startDot === -1)
        startDot = i;
      else if (preDotState !== 1)
        preDotState = 1;
    } else if (startDot !== -1)
      preDotState = -1;
  }
  if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
    return "";
  return path.slice(startDot, end);
}
function format(pathObject) {
  if (pathObject === null || typeof pathObject !== "object")
    throw TypeError('The "pathObject" argument must be of type Object. Received type ' + typeof pathObject);
  return _format("/", pathObject);
}
function parse(path) {
  assertPath(path);
  var ret = { root: "", dir: "", base: "", ext: "", name: "" };
  if (path.length === 0)
    return ret;
  var code = path.charCodeAt(0), isAbsolute2 = code === 47, start;
  if (isAbsolute2)
    ret.root = "/", start = 1;
  else
    start = 0;
  var startDot = -1, startPart = 0, end = -1, matchedSlash = true, i = path.length - 1, preDotState = 0;
  for (;i >= start; --i) {
    if (code = path.charCodeAt(i), code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1)
      matchedSlash = false, end = i + 1;
    if (code === 46) {
      if (startDot === -1)
        startDot = i;
      else if (preDotState !== 1)
        preDotState = 1;
    } else if (startDot !== -1)
      preDotState = -1;
  }
  if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
    if (end !== -1)
      if (startPart === 0 && isAbsolute2)
        ret.base = ret.name = path.slice(1, end);
      else
        ret.base = ret.name = path.slice(startPart, end);
  } else {
    if (startPart === 0 && isAbsolute2)
      ret.name = path.slice(1, startDot), ret.base = path.slice(1, end);
    else
      ret.name = path.slice(startPart, startDot), ret.base = path.slice(startPart, end);
    ret.ext = path.slice(startDot, end);
  }
  if (startPart > 0)
    ret.dir = path.slice(0, startPart - 1);
  else if (isAbsolute2)
    ret.dir = "/";
  return ret;
}
var sep = "/";
var delimiter = ":";
var posix = ((p) => (p.posix = p, p))({ resolve, normalize, isAbsolute, join, relative, _makeLong, dirname, basename, extname, format, parse, sep, delimiter, win32: null, posix: null });

// src/layouts.ts
var MIN_ROWS = 6;
var layouts1 = [
  {
    name: "full",
    panes: [{ x: 0, y: 0, width: 1, height: 1 }]
  }
];
var layouts2 = [
  {
    name: "50/50",
    panes: [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: 1 }
    ]
  }
];
var layouts3 = [
  {
    name: "left + right with bottom",
    panes: [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: -MIN_ROWS },
      { x: 0.5, y: -MIN_ROWS, width: 0.5, height: MIN_ROWS }
    ]
  },
  {
    name: "left with bottom + right",
    panes: [
      { x: 0, y: 0, width: 0.5, height: -MIN_ROWS },
      { x: 0, y: -MIN_ROWS, width: 0.5, height: MIN_ROWS },
      { x: 0.5, y: 0, width: 0.5, height: 1 }
    ]
  },
  {
    name: "left + right stacked",
    panes: [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }
    ]
  },
  {
    name: "left stacked + right",
    panes: [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: 1 }
    ]
  }
];
var layouts4 = [
  {
    name: "both with bottom",
    panes: [
      { x: 0, y: 0, width: 0.5, height: -MIN_ROWS },
      { x: 0, y: -MIN_ROWS, width: 0.5, height: MIN_ROWS },
      { x: 0.5, y: 0, width: 0.5, height: -MIN_ROWS },
      { x: 0.5, y: -MIN_ROWS, width: 0.5, height: MIN_ROWS }
    ]
  },
  {
    name: "left min + right stacked",
    panes: [
      { x: 0, y: 0, width: 0.5, height: -MIN_ROWS },
      { x: 0, y: -MIN_ROWS, width: 0.5, height: MIN_ROWS },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }
    ]
  },
  {
    name: "left stacked + right min",
    panes: [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: -MIN_ROWS },
      { x: 0.5, y: -MIN_ROWS, width: 0.5, height: MIN_ROWS }
    ]
  },
  {
    name: "both stacked",
    panes: [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }
    ]
  }
];
var ALL_LAYOUTS = [
  ...layouts1,
  ...layouts2,
  ...layouts3,
  ...layouts4
];
function resolveLayout(template, windowWidth, windowHeight) {
  const xPositions = [...new Set(template.panes.map((p) => p.x))].sort((a, b) => a - b);
  const numVSeparators = xPositions.length - 1;
  const usableWidth = windowWidth - numVSeparators;
  const columns = new Map;
  for (const pane of template.panes) {
    if (!columns.has(pane.x))
      columns.set(pane.x, []);
    columns.get(pane.x).push(pane.y);
  }
  return template.panes.map((pane) => {
    const colIndex = xPositions.indexOf(pane.x);
    const xBase = Math.floor(pane.x * usableWidth);
    const x = xBase + colIndex;
    let width;
    if (pane.x + pane.width >= 1) {
      width = windowWidth - x;
    } else {
      width = Math.floor(pane.width * usableWidth);
    }
    const yPositionsInCol = [...new Set(template.panes.filter((p) => p.x === pane.x).map((p) => p.y))].sort((a, b) => a - b);
    const numHSeparators = yPositionsInCol.length - 1;
    const usableHeight = windowHeight - numHSeparators;
    let y;
    const rowIndex = yPositionsInCol.indexOf(pane.y);
    if (pane.y < 0) {
      const absRows = Math.abs(pane.y);
      y = windowHeight - absRows;
    } else if (pane.y <= 1) {
      const yBase = Math.floor(pane.y * usableHeight);
      y = yBase + rowIndex;
    } else {
      y = pane.y;
    }
    let height;
    if (pane.height < 0 && pane.height > -1) {
      height = Math.floor(Math.abs(pane.height) * usableHeight);
    } else if (pane.height < 0) {
      const reservedRows = Math.abs(pane.height);
      height = windowHeight - reservedRows - 1;
    } else if (pane.height <= 1) {
      if (pane.y + pane.height >= 1) {
        height = windowHeight - y;
      } else {
        height = Math.floor(pane.height * usableHeight);
      }
    } else {
      height = pane.height;
    }
    return { x, y, width, height };
  });
}

// src/layout-preview.ts
var box = {
  tl: "┌",
  tr: "┐",
  bl: "└",
  br: "┘",
  h: "─",
  v: "│",
  ltee: "├",
  rtee: "┤",
  ttee: "┬",
  btee: "┴",
  cross: "┼"
};
function toRects(template, width, height) {
  return template.panes.map((pane) => {
    const py = pane.y < 0 ? 0.7 : pane.y;
    const ph = pane.height > 0 && pane.height <= 1 ? pane.height : 0.3;
    return {
      x: Math.floor(pane.x * width),
      y: Math.floor(py * height),
      w: Math.floor(pane.width * width),
      h: Math.floor(ph * height)
    };
  });
}
function renderLayoutPreview(template, width, height) {
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => " "));
  const rects = toRects(template, width, height);
  drawBox(grid, 0, 0, width, height);
  const xSplits = new Set;
  const ySplits = new Set;
  for (const rect of rects) {
    if (rect.x > 0)
      xSplits.add(rect.x);
    if (rect.y > 0)
      ySplits.add(rect.y);
  }
  for (const x of xSplits) {
    if (x > 0 && x < width - 1) {
      drawVLine(grid, x, 0, height);
    }
  }
  for (const y of ySplits) {
    if (y > 0 && y < height - 1) {
      const panesAtY = rects.filter((r) => r.y === y);
      for (const pane of panesAtY) {
        drawHLine(grid, pane.x, y, pane.w);
      }
    }
  }
  fixIntersections(grid, width, height);
  const sortedRects = [...rects].map((r, i) => ({ ...r, origIndex: i, area: r.w * r.h })).sort((a, b) => b.area - a.area);
  sortedRects.forEach((rect, i) => {
    const cx = rect.x + Math.floor(rect.w / 2);
    const cy = rect.y + Math.floor(rect.h / 2);
    if (cx > 0 && cx < width - 1 && cy > 0 && cy < height - 1) {
      grid[cy][cx] = String(i + 1);
    }
  });
  return grid.map((row) => row.join(""));
}
function drawBox(grid, x, y, w, h) {
  const maxY = grid.length - 1;
  const maxX = grid[0].length - 1;
  if (y <= maxY && x <= maxX)
    grid[y][x] = box.tl;
  if (y <= maxY && x + w - 1 <= maxX)
    grid[y][x + w - 1] = box.tr;
  if (y + h - 1 <= maxY && x <= maxX)
    grid[y + h - 1][x] = box.bl;
  if (y + h - 1 <= maxY && x + w - 1 <= maxX)
    grid[y + h - 1][x + w - 1] = box.br;
  for (let i = x + 1;i < x + w - 1 && i <= maxX; i++) {
    if (y <= maxY)
      grid[y][i] = box.h;
    if (y + h - 1 <= maxY)
      grid[y + h - 1][i] = box.h;
  }
  for (let j = y + 1;j < y + h - 1 && j <= maxY; j++) {
    if (x <= maxX)
      grid[j][x] = box.v;
    if (x + w - 1 <= maxX)
      grid[j][x + w - 1] = box.v;
  }
}
function drawVLine(grid, x, y, h) {
  for (let j = y;j < y + h && j < grid.length; j++) {
    if (x < grid[0].length) {
      const current = grid[j][x];
      if (current === " ") {
        grid[j][x] = box.v;
      }
    }
  }
}
function drawHLine(grid, x, y, w) {
  if (y >= grid.length)
    return;
  for (let i = x;i < x + w && i < grid[0].length; i++) {
    const current = grid[y][i];
    if (current === " ") {
      grid[y][i] = box.h;
    }
  }
}
function fixIntersections(grid, width, height) {
  for (let y = 0;y < height; y++) {
    for (let x = 0;x < width; x++) {
      const c = grid[y][x];
      if (c !== box.h && c !== box.v)
        continue;
      const up = y > 0 ? grid[y - 1][x] : null;
      const down = y < height - 1 ? grid[y + 1][x] : null;
      const left = x > 0 ? grid[y][x - 1] : null;
      const right = x < width - 1 ? grid[y][x + 1] : null;
      const hasUp = isVertical(up);
      const hasDown = isVertical(down);
      const hasLeft = isHorizontal(left);
      const hasRight = isHorizontal(right);
      if (hasUp && hasDown && hasLeft && hasRight) {
        grid[y][x] = box.cross;
      } else if (hasUp && hasDown && hasRight && !hasLeft) {
        grid[y][x] = box.ltee;
      } else if (hasUp && hasDown && hasLeft && !hasRight) {
        grid[y][x] = box.rtee;
      } else if (hasLeft && hasRight && hasDown && !hasUp) {
        grid[y][x] = box.ttee;
      } else if (hasLeft && hasRight && hasUp && !hasDown) {
        grid[y][x] = box.btee;
      }
    }
  }
}
function isVertical(c) {
  return c === box.v || c === box.ltee || c === box.rtee || c === box.cross || c === box.tl || c === box.tr || c === box.bl || c === box.br || c === box.ttee || c === box.btee;
}
function isHorizontal(c) {
  return c === box.h || c === box.ltee || c === box.rtee || c === box.cross || c === box.tl || c === box.tr || c === box.bl || c === box.br || c === box.ttee || c === box.btee;
}
if (false) {}

// src/tmux.ts
var {execSync, exec} = (() => ({}));

// node:util
var formatRegExp = /%[sdj%]/g;
function format2(f, ...args) {
  if (!isString(f)) {
    var objects = [f];
    for (var i = 0;i < args.length; i++)
      objects.push(inspect(args[i]));
    return objects.join(" ");
  }
  var i = 0, len = args.length, str = String(f).replace(formatRegExp, function(x2) {
    if (x2 === "%%")
      return "%";
    if (i >= len)
      return x2;
    switch (x2) {
      case "%s":
        return String(args[i++]);
      case "%d":
        return Number(args[i++]);
      case "%j":
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return "[Circular]";
        }
      default:
        return x2;
    }
  });
  for (var x = args[i];i < len; x = args[++i])
    if (isNull(x) || !isObject(x))
      str += " " + x;
    else
      str += " " + inspect(x);
  return str;
}
var debuglog = ((debugs = {}, debugEnvRegex = {}, debugEnv) => ((debugEnv = typeof process < "u" && false) && (debugEnv = debugEnv.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*").replace(/,/g, "$|^").toUpperCase()), debugEnvRegex = new RegExp("^" + debugEnv + "$", "i"), (set) => {
  if (set = set.toUpperCase(), !debugs[set])
    if (debugEnvRegex.test(set))
      debugs[set] = function(...args) {
        console.error("%s: %s", set, pid, format2.apply(null, ...args));
      };
    else
      debugs[set] = function() {};
  return debugs[set];
}))();
var inspect = ((i) => (i.colors = { bold: [1, 22], italic: [3, 23], underline: [4, 24], inverse: [7, 27], white: [37, 39], grey: [90, 39], black: [30, 39], blue: [34, 39], cyan: [36, 39], green: [32, 39], magenta: [35, 39], red: [31, 39], yellow: [33, 39] }, i.styles = { special: "cyan", number: "yellow", boolean: "yellow", undefined: "grey", null: "bold", string: "green", date: "magenta", regexp: "red" }, i.custom = Symbol.for("nodejs.util.inspect.custom"), i))(function(obj, opts, ...rest) {
  var ctx = { seen: [], stylize: stylizeNoColor };
  if (rest.length >= 1)
    ctx.depth = rest[0];
  if (rest.length >= 2)
    ctx.colors = rest[1];
  if (isBoolean(opts))
    ctx.showHidden = opts;
  else if (opts)
    _extend(ctx, opts);
  if (isUndefined(ctx.showHidden))
    ctx.showHidden = false;
  if (isUndefined(ctx.depth))
    ctx.depth = 2;
  if (isUndefined(ctx.colors))
    ctx.colors = false;
  if (ctx.colors)
    ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
});
function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];
  if (style)
    return "\x1B[" + inspect.colors[style][0] + "m" + str + "\x1B[" + inspect.colors[style][1] + "m";
  else
    return str;
}
function stylizeNoColor(str, styleType) {
  return str;
}
function arrayToHash(array) {
  var hash = {};
  return array.forEach(function(val, idx) {
    hash[val] = true;
  }), hash;
}
function formatValue(ctx, value, recurseTimes) {
  if (ctx.customInspect && value && isFunction(value.inspect) && value.inspect !== inspect && !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret))
      ret = formatValue(ctx, ret, recurseTimes);
    return ret;
  }
  var primitive = formatPrimitive(ctx, value);
  if (primitive)
    return primitive;
  var keys = Object.keys(value), visibleKeys = arrayToHash(keys);
  if (ctx.showHidden)
    keys = Object.getOwnPropertyNames(value);
  if (isError(value) && (keys.indexOf("message") >= 0 || keys.indexOf("description") >= 0))
    return formatError(value);
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ": " + value.name : "";
      return ctx.stylize("[Function" + name + "]", "special");
    }
    if (isRegExp(value))
      return ctx.stylize(RegExp.prototype.toString.call(value), "regexp");
    if (isDate(value))
      return ctx.stylize(Date.prototype.toString.call(value), "date");
    if (isError(value))
      return formatError(value);
  }
  var base = "", array = false, braces = ["{", "}"];
  if (isArray(value))
    array = true, braces = ["[", "]"];
  if (isFunction(value)) {
    var n = value.name ? ": " + value.name : "";
    base = " [Function" + n + "]";
  }
  if (isRegExp(value))
    base = " " + RegExp.prototype.toString.call(value);
  if (isDate(value))
    base = " " + Date.prototype.toUTCString.call(value);
  if (isError(value))
    base = " " + formatError(value);
  if (keys.length === 0 && (!array || value.length == 0))
    return braces[0] + base + braces[1];
  if (recurseTimes < 0)
    if (isRegExp(value))
      return ctx.stylize(RegExp.prototype.toString.call(value), "regexp");
    else
      return ctx.stylize("[Object]", "special");
  ctx.seen.push(value);
  var output;
  if (array)
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  else
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  return ctx.seen.pop(), reduceToSingleString(output, base, braces);
}
function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize("undefined", "undefined");
  if (isString(value)) {
    var simple = "'" + JSON.stringify(value).replace(/^"|"$/g, "").replace(/'/g, "\\'").replace(/\\"/g, '"') + "'";
    return ctx.stylize(simple, "string");
  }
  if (isNumber(value))
    return ctx.stylize("" + value, "number");
  if (isBoolean(value))
    return ctx.stylize("" + value, "boolean");
  if (isNull(value))
    return ctx.stylize("null", "null");
}
function formatError(value) {
  return "[" + Error.prototype.toString.call(value) + "]";
}
function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length;i < l; ++i)
    if (hasOwnProperty(value, String(i)))
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys, String(i), true));
    else
      output.push("");
  return keys.forEach(function(key) {
    if (!key.match(/^\d+$/))
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys, key, true));
  }), output;
}
function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  if (desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] }, desc.get)
    if (desc.set)
      str = ctx.stylize("[Getter/Setter]", "special");
    else
      str = ctx.stylize("[Getter]", "special");
  else if (desc.set)
    str = ctx.stylize("[Setter]", "special");
  if (!hasOwnProperty(visibleKeys, key))
    name = "[" + key + "]";
  if (!str)
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes))
        str = formatValue(ctx, desc.value, null);
      else
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      if (str.indexOf(`
`) > -1)
        if (array)
          str = str.split(`
`).map(function(line) {
            return "  " + line;
          }).join(`
`).slice(2);
        else
          str = `
` + str.split(`
`).map(function(line) {
            return "   " + line;
          }).join(`
`);
    } else
      str = ctx.stylize("[Circular]", "special");
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/))
      return str;
    if (name = JSON.stringify("" + key), name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/))
      name = name.slice(1, -1), name = ctx.stylize(name, "name");
    else
      name = name.replace(/'/g, "\\'").replace(/\\"/g, '"').replace(/(^"|"$)/g, "'"), name = ctx.stylize(name, "string");
  }
  return name + ": " + str;
}
function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0, length = output.reduce(function(prev, cur) {
    if (numLinesEst++, cur.indexOf(`
`) >= 0)
      numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, "").length + 1;
  }, 0);
  if (length > 60)
    return braces[0] + (base === "" ? "" : base + `
 `) + " " + output.join(`,
  `) + " " + braces[1];
  return braces[0] + base + " " + output.join(", ") + " " + braces[1];
}
function isArray(ar) {
  return Array.isArray(ar);
}
function isBoolean(arg) {
  return typeof arg === "boolean";
}
function isNull(arg) {
  return arg === null;
}
function isNumber(arg) {
  return typeof arg === "number";
}
function isString(arg) {
  return typeof arg === "string";
}
function isUndefined(arg) {
  return arg === undefined;
}
function isRegExp(re) {
  return isObject(re) && objectToString(re) === "[object RegExp]";
}
function isObject(arg) {
  return typeof arg === "object" && arg !== null;
}
function isDate(d) {
  return isObject(d) && objectToString(d) === "[object Date]";
}
function isError(e) {
  return isObject(e) && (objectToString(e) === "[object Error]" || e instanceof Error);
}
function isFunction(arg) {
  return typeof arg === "function";
}
function objectToString(o) {
  return Object.prototype.toString.call(o);
}
function _extend(origin, add) {
  if (!add || !isObject(add))
    return origin;
  var keys = Object.keys(add), i = keys.length;
  while (i--)
    origin[keys[i]] = add[keys[i]];
  return origin;
}
function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}
var promisify = ((x) => (x.custom = Symbol.for("nodejs.util.promisify.custom"), x))(function(original) {
  if (typeof original !== "function")
    throw TypeError('The "original" argument must be of type Function');
  if (kCustomPromisifiedSymbol && original[kCustomPromisifiedSymbol]) {
    var fn = original[kCustomPromisifiedSymbol];
    if (typeof fn !== "function")
      throw TypeError('The "nodejs.util.promisify.custom" argument must be of type Function');
    return Object.defineProperty(fn, kCustomPromisifiedSymbol, { value: fn, enumerable: false, writable: false, configurable: true }), fn;
  }
  function fn(...args) {
    var promiseResolve, promiseReject, promise = new Promise(function(resolve2, reject) {
      promiseResolve = resolve2, promiseReject = reject;
    });
    args.push(function(err, value) {
      if (err)
        promiseReject(err);
      else
        promiseResolve(value);
    });
    try {
      original.apply(this, args);
    } catch (err) {
      promiseReject(err);
    }
    return promise;
  }
  if (Object.setPrototypeOf(fn, Object.getPrototypeOf(original)), kCustomPromisifiedSymbol)
    Object.defineProperty(fn, kCustomPromisifiedSymbol, { value: fn, enumerable: false, writable: false, configurable: true });
  return Object.defineProperties(fn, Object.getOwnPropertyDescriptors(original));
});

// src/tmux.ts
var execAsync = promisify(exec);
function getWindowInfo() {
  const format3 = "#{window_width}:#{window_height}:#{pane_id}:#{pane_width}:#{pane_height}:#{pane_left}:#{pane_top}:#{pane_title}";
  const output = execSync(`tmux list-panes -F '${format3}'`).toString().trim();
  const lines = output.split(`
`);
  const [width, height] = lines[0].split(":").slice(0, 2).map(Number);
  const panes = lines.map((line) => {
    const parts = line.split(":");
    return {
      id: parts[2],
      width: Number(parts[3]),
      height: Number(parts[4]),
      left: Number(parts[5]),
      top: Number(parts[6]),
      title: parts[7] || ""
    };
  });
  return { width, height, panes };
}
function getWindows() {
  const format3 = "#{window_index}:#{window_name}:#{window_active}:#{window_bell_flag}:#{window_activity_flag}:#{pane_current_command}";
  const output = execSync(`tmux list-windows -F '${format3}'`).toString().trim();
  return output.split(`
`).map((line) => {
    const [index, name, active, bell, activity, paneCommand] = line.split(":");
    return {
      index: Number(index),
      name,
      active: active === "1",
      bell: bell === "1",
      activity: activity === "1",
      paneCommand: paneCommand || ""
    };
  });
}
function extractRepoNameFromUrl(url) {
  let cleanUrl = url.endsWith(".git") ? url.slice(0, -4) : url;
  const colonIndex = cleanUrl.indexOf(":");
  if (colonIndex > 0 && !cleanUrl.startsWith("http")) {
    const path = cleanUrl.slice(colonIndex + 1);
    const lastSlash2 = path.lastIndexOf("/");
    return lastSlash2 >= 0 ? path.slice(lastSlash2 + 1) : path;
  }
  const lastSlash = cleanUrl.lastIndexOf("/");
  if (lastSlash >= 0) {
    return cleanUrl.slice(lastSlash + 1);
  }
  return cleanUrl || null;
}
async function getPaneContext(windowTarget, paneIndex) {
  const target = `${windowTarget}.${paneIndex}`;
  const [workdirResult, programResult, transcriptResult] = await Promise.all([
    execAsync(`tmux display-message -p -t '${target}' '#{pane_current_path}'`).catch(() => ({ stdout: "" })),
    execAsync(`tmux display-message -p -t '${target}' '#{pane_current_command}'`).catch(() => ({ stdout: "" })),
    execAsync(`tmux capture-pane -p -t '${target}' -S -50`).catch(() => ({ stdout: "" }))
  ]);
  const workdir = workdirResult.stdout.trim();
  const program = programResult.stdout.trim();
  const transcript = transcriptResult.stdout.trimEnd();
  let gitBranch = null;
  let gitRepoName = null;
  if (workdir) {
    try {
      const [branchResult, remoteResult] = await Promise.all([
        execAsync(`git -C '${workdir}' branch --show-current 2>/dev/null`),
        execAsync(`git -C '${workdir}' remote get-url origin 2>/dev/null`)
      ]);
      const branch = branchResult.stdout.trim();
      if (branch) {
        gitBranch = branch;
      }
      const remoteUrl = remoteResult.stdout.trim();
      if (remoteUrl) {
        gitRepoName = extractRepoNameFromUrl(remoteUrl);
      }
    } catch {}
  }
  return {
    workdir,
    program,
    transcript,
    gitBranch,
    gitRepoName
  };
}
async function getWindowContext(windowIndex) {
  const windowTarget = `:${windowIndex}`;
  const [nameResult, panesResult] = await Promise.all([
    execAsync(`tmux display-message -p -t '${windowTarget}' '#{window_name}'`),
    execAsync(`tmux list-panes -t '${windowTarget}' -F '#{pane_index}:#{pane_active}'`)
  ]);
  const windowName = nameResult.stdout.trim();
  const paneLines = panesResult.stdout.trim().split(`
`);
  let activePaneIndex = 0;
  const paneIndices = [];
  for (const line of paneLines) {
    const [indexStr, activeStr] = line.split(":");
    const paneIndex = Number(indexStr);
    paneIndices.push(paneIndex);
    if (activeStr === "1") {
      activePaneIndex = paneIndices.length - 1;
    }
  }
  const panes = await Promise.all(paneIndices.map((paneIndex) => getPaneContext(windowTarget, paneIndex)));
  return {
    windowIndex,
    windowName,
    panes,
    activePaneIndex
  };
}

// src/tmux-layout.ts
function calculateChecksum(layout) {
  let csum = 0;
  for (let i = 0;i < layout.length; i++) {
    csum = (csum >> 1) + ((csum & 1) << 15);
    csum += layout.charCodeAt(i);
    csum &= 65535;
  }
  return csum.toString(16).padStart(4, "0");
}
function buildLayoutTree(panes, x, y, width, height) {
  if (panes.length === 0) {
    throw new Error("No panes provided");
  }
  if (panes.length === 1) {
    const pane = panes[0];
    return {
      x: pane.x,
      y: pane.y,
      width: pane.width,
      height: pane.height,
      paneId: pane.id
    };
  }
  const xPositions = [...new Set(panes.map((p) => p.x))].sort((a, b) => a - b);
  const yPositions = [...new Set(panes.map((p) => p.y))].sort((a, b) => a - b);
  if (xPositions.length > 1) {
    const columns = new Map;
    for (const pane of panes) {
      let colX = xPositions[0];
      for (const xPos of xPositions) {
        if (pane.x >= xPos)
          colX = xPos;
      }
      if (!columns.has(colX))
        columns.set(colX, []);
      columns.get(colX).push(pane);
    }
    if (columns.size > 1) {
      const children = [];
      for (const colX of [...columns.keys()].sort((a, b) => a - b)) {
        const colPanes = columns.get(colX);
        const colWidth = Math.max(...colPanes.map((p) => p.x + p.width)) - colX;
        const child = buildLayoutTree(colPanes, colX, y, colWidth, height);
        children.push(child);
      }
      return {
        x,
        y,
        width,
        height,
        splitType: "horizontal",
        children
      };
    }
  }
  if (yPositions.length > 1) {
    const rows = new Map;
    for (const pane of panes) {
      let rowY = yPositions[0];
      for (const yPos of yPositions) {
        if (pane.y >= yPos)
          rowY = yPos;
      }
      if (!rows.has(rowY))
        rows.set(rowY, []);
      rows.get(rowY).push(pane);
    }
    if (rows.size > 1) {
      const children = [];
      for (const rowY of [...rows.keys()].sort((a, b) => a - b)) {
        const rowPanes = rows.get(rowY);
        const rowHeight = Math.max(...rowPanes.map((p) => p.y + p.height)) - rowY;
        const child = buildLayoutTree(rowPanes, x, rowY, width, rowHeight);
        children.push(child);
      }
      return {
        x,
        y,
        width,
        height,
        splitType: "vertical",
        children
      };
    }
  }
  return {
    x,
    y,
    width,
    height,
    paneId: panes[0].id
  };
}
function serializeLayoutNode(node) {
  const base = `${node.width}x${node.height},${node.x},${node.y}`;
  if (node.paneId !== undefined) {
    const paneNum = node.paneId.replace("%", "");
    return `${base},${paneNum}`;
  }
  if (node.children && node.children.length > 0) {
    const childStr = node.children.map(serializeLayoutNode).join(",");
    if (node.splitType === "horizontal") {
      return `${base}{${childStr}}`;
    } else {
      return `${base}[${childStr}]`;
    }
  }
  throw new Error("Invalid node: no paneId and no children");
}
function generateLayoutString(panes, windowWidth, windowHeight) {
  const tree = buildLayoutTree(panes, 0, 0, windowWidth, windowHeight);
  const layout = serializeLayoutNode(tree);
  const checksum = calculateChecksum(layout);
  return `${checksum},${layout}`;
}

// src/logger.ts
var {appendFileSync, writeFileSync} = (() => ({}));
var LOG_FILE = "/tmp/cmux.log";
function initLog() {
  writeFileSync(LOG_FILE, `=== cmux started ${new Date().toISOString()} ===
`);
}
function log(...args) {
  const msg = args.map((a) => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ");
  try {
    appendFileSync(LOG_FILE, `${msg}
`);
  } catch (e) {}
}

// src/summaries.ts
var cache = new Map;
var DEFAULT_BRANCHES = ["main", "master", "develop", "dev"];
function extractDisplayName(gitRepoName, workdir) {
  if (gitRepoName)
    return gitRepoName;
  if (!workdir)
    return "shell";
  return basename(workdir) || "shell";
}
function getWindowName(cwd, branch, gitRepoName) {
  const repo = extractDisplayName(gitRepoName ?? null, cwd);
  if (!branch || DEFAULT_BRANCHES.includes(branch)) {
    return repo;
  }
  const shortBranch = branch.includes("/") ? branch.substring(branch.lastIndexOf("/") + 1) : branch;
  return `${repo}/${shortBranch}`;
}
function hashContext(context) {
  const activePaneIndex = context.activePaneIndex ?? 0;
  const pane = context.panes[activePaneIndex] ?? context.panes[0];
  if (!pane)
    return "";
  return `${pane.workdir}|${pane.gitBranch ?? ""}`;
}
function generateSummary(context) {
  log("[cmux] generateSummary called for window:", context.windowIndex);
  const activePaneIndex = context.activePaneIndex ?? 0;
  const pane = context.panes[activePaneIndex] ?? context.panes[0];
  if (!pane) {
    log("[cmux] No panes found, using window name");
    return context.windowName;
  }
  const name = getWindowName(pane.workdir, pane.gitBranch, pane.gitRepoName);
  log(`[cmux] Generated name: "${name}" from workdir="${pane.workdir}", branch="${pane.gitBranch}", gitRepoName="${pane.gitRepoName}"`);
  return name;
}
function getSummary(context) {
  const currentHash = hashContext(context);
  const cached = cache.get(context.windowIndex);
  if (cached && cached.contextHash === currentHash) {
    return cached.summary;
  }
  const summary = generateSummary(context);
  cache.set(context.windowIndex, {
    summary,
    contextHash: currentHash
  });
  return summary;
}
function getSummariesForWindows(contexts) {
  const results = new Map;
  for (const context of contexts) {
    const summary = getSummary(context);
    results.set(context.windowIndex, summary);
  }
  return results;
}

// src/utils.ts
function truncateName(name) {
  if (name.length <= 15)
    return name;
  return name.slice(0, 14) + "…";
}
function splitWindowName(name) {
  const slashIndex = name.indexOf("/");
  if (slashIndex > 0 && slashIndex < name.length - 1) {
    const line1 = name.slice(0, slashIndex);
    const line2 = name.slice(slashIndex + 1);
    return [truncateName(line1), truncateName(line2)];
  }
  return [truncateName(name), ""];
}
function sanitizeWindowName(summary, maxLength = 50) {
  let name = summary.replace(/["'`$\\]/g, "").replace(/[^\x20-\x7E]/g, "").trim();
  if (name.length <= maxLength) {
    return name;
  }
  name = name.slice(0, maxLength);
  const lastSpace = name.lastIndexOf(" ");
  const lastHyphen = name.lastIndexOf("-");
  const boundary = Math.max(lastSpace, lastHyphen);
  if (boundary > 0 && boundary < name.length - 1) {
    name = name.slice(0, boundary);
  }
  name = name.replace(/[-_:;,.\s]+$/, "").trim();
  return name;
}

// src/dir-picker.ts
var {readdirSync} = (() => ({}));
function initDirPickerState(currentPath) {
  const parentPath = dirname(currentPath);
  const cousins = getCousinDirectories(currentPath);
  return {
    input: "",
    cousins,
    filtered: cousins,
    selectedIndex: 0,
    parentPath,
    currentPath
  };
}
function getCousinDirectories(currentPath) {
  const parentPath = dirname(currentPath);
  const currentName = basename(currentPath);
  try {
    const entries = readdirSync(parentPath, { withFileTypes: true });
    const siblings = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== currentName).map((e) => e.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    return [currentName, ...siblings];
  } catch {
    return [currentName];
  }
}
function filterCousins(cousins, input) {
  if (!input)
    return cousins;
  const lowerInput = input.toLowerCase();
  return cousins.filter((name) => name.toLowerCase().startsWith(lowerInput));
}
function handleDirPickerKey(state, key) {
  if (key === "\x1B") {
    return { action: "cancel" };
  }
  if (key === "\r") {
    const { input, filtered, selectedIndex, parentPath, currentPath } = state;
    if (filtered.length > 0) {
      const selectedName = filtered[selectedIndex];
      const selectedPath = join(parentPath, selectedName);
      return { action: "select", path: selectedPath };
    } else if (input.length > 0) {
      const relativePath = join(currentPath, input);
      return { action: "select", path: relativePath };
    }
    return { action: "cancel" };
  }
  if (key === "\x10" || key === "\x1B[A") {
    const newIndex = state.selectedIndex > 0 ? state.selectedIndex - 1 : state.filtered.length - 1;
    return {
      action: "continue",
      state: { ...state, selectedIndex: newIndex }
    };
  }
  if (key === "\x0E" || key === "\x1B[B") {
    const newIndex = state.selectedIndex < state.filtered.length - 1 ? state.selectedIndex + 1 : 0;
    return {
      action: "continue",
      state: { ...state, selectedIndex: newIndex }
    };
  }
  if (key === "" || key === "\b") {
    if (state.input.length === 0) {
      return { action: "continue", state };
    }
    const newInput = state.input.slice(0, -1);
    const newFiltered = filterCousins(state.cousins, newInput);
    return {
      action: "continue",
      state: {
        ...state,
        input: newInput,
        filtered: newFiltered,
        selectedIndex: 0
      }
    };
  }
  if (key.length === 1 && key >= " " && key <= "~") {
    const newInput = state.input + key;
    const newFiltered = filterCousins(state.cousins, newInput);
    return {
      action: "continue",
      state: {
        ...state,
        input: newInput,
        filtered: newFiltered,
        selectedIndex: 0
      }
    };
  }
  return { action: "continue", state };
}
var box2 = {
  tl: "┌",
  tr: "┐",
  bl: "└",
  br: "┘",
  h: "─",
  v: "│"
};
function renderDirPicker(state, width, height) {
  const { input, filtered, selectedIndex } = state;
  const boxWidth = Math.min(width - 4, 40);
  const boxHeight = Math.min(height - 4, 12);
  const boxX = Math.floor((width - boxWidth) / 2);
  const boxY = Math.floor((height - boxHeight) / 2);
  let lines = [];
  lines.push(box2.tl + box2.h.repeat(boxWidth - 2) + box2.tr);
  const inputLabel = "> ";
  const cursor = "█";
  const maxInputLen = boxWidth - 4 - inputLabel.length - cursor.length;
  const displayInput = input.length > maxInputLen ? input.slice(-maxInputLen) : input;
  const inputLine = inputLabel + displayInput + cursor;
  const inputPadded = inputLine.padEnd(boxWidth - 2);
  lines.push(box2.v + inputPadded + box2.v);
  lines.push(box2.v + " ".repeat(boxWidth - 2) + box2.v);
  const listHeight = boxHeight - 4;
  const visibleCount = Math.min(filtered.length, listHeight);
  let scrollOffset = 0;
  if (selectedIndex >= listHeight) {
    scrollOffset = selectedIndex - listHeight + 1;
  }
  for (let i = 0;i < listHeight; i++) {
    const itemIndex = i + scrollOffset;
    if (itemIndex < filtered.length) {
      const name = filtered[itemIndex];
      const isSelected = itemIndex === selectedIndex;
      const prefix = isSelected ? "→ " : "  ";
      const maxNameLen = boxWidth - 4 - prefix.length;
      const displayName = name.length > maxNameLen ? name.slice(0, maxNameLen - 1) + "…" : name;
      const line = prefix + displayName;
      const padded = line.padEnd(boxWidth - 2);
      lines.push(box2.v + padded + box2.v);
    } else {
      lines.push(box2.v + " ".repeat(boxWidth - 2) + box2.v);
    }
  }
  lines.push(box2.bl + box2.h.repeat(boxWidth - 2) + box2.br);
  const ESC = "\x1B";
  const CSI = `${ESC}[`;
  const moveTo = (x, y) => `${CSI}${y + 1};${x + 1}H`;
  let output = "";
  for (let i = 0;i < lines.length; i++) {
    output += moveTo(boxX, boxY + i) + lines[i];
  }
  return output;
}

// src/main.ts
var CONFIG_PATH = join(import.meta.dir, "../config/tmux.conf");
var SELF_PATH = import.meta.path;
var BACKGROUND_RENAMER_PATH = join(import.meta.dir, "background-renamer.ts");
function initState() {
  let windows = [];
  let currentWindowIndex = 0;
  let layoutIndex = 0;
  let currentPaneCount = 1;
  try {
    windows = getWindows();
    currentWindowIndex = windows.findIndex((w) => w.active);
    if (currentWindowIndex < 0)
      currentWindowIndex = 0;
    const windowInfo = getWindowInfo();
    currentPaneCount = windowInfo.panes.length;
    layoutIndex = ALL_LAYOUTS.findIndex((l) => l.panes.length === currentPaneCount);
    if (layoutIndex < 0)
      layoutIndex = 0;
  } catch (e) {
    windows = [
      { index: 0, name: "backend", active: true, bell: false, activity: false, paneCommand: "" },
      { index: 1, name: "frontend", active: false, bell: false, activity: false, paneCommand: "" },
      { index: 2, name: "logs", active: false, bell: false, activity: false, paneCommand: "" }
    ];
  }
  return {
    windows,
    currentWindowIndex,
    layoutIndex,
    carouselIndex: currentWindowIndex + 1,
    focus: "window",
    mode: "main",
    animating: false,
    animationDirection: null,
    animationFrame: 0,
    previousLayoutIndex: layoutIndex,
    confirmingDelete: false,
    dirPicker: null
  };
}
var state = initState();
var pollInterval = null;
var POLL_INTERVAL_MS = 1500;
function windowsChanged(oldWindows, newWindows) {
  if (oldWindows.length !== newWindows.length)
    return true;
  return oldWindows.some((w, i) => w.name !== newWindows[i].name || w.index !== newWindows[i].index || w.active !== newWindows[i].active);
}
function startPolling() {
  pollInterval = setInterval(async () => {
    try {
      const newWindows = getWindows();
      if (windowsChanged(state.windows, newWindows)) {
        const newActiveIndex = newWindows.findIndex((w) => w.active);
        if (newActiveIndex >= 0 && state.currentWindowIndex !== newActiveIndex) {
          state.currentWindowIndex = newActiveIndex;
        }
        if (state.currentWindowIndex >= newWindows.length) {
          state.currentWindowIndex = Math.max(0, newWindows.length - 1);
        }
        state.windows = newWindows;
        render();
      }
    } catch {}
  }, POLL_INTERVAL_MS);
}
function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
var ESC = "\x1B";
var CSI = `${ESC}[`;
var ansi = {
  clear: `${CSI}2J${CSI}H`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  altScreen: `${CSI}?1049h`,
  exitAltScreen: `${CSI}?1049l`,
  moveTo: (x, y) => `${CSI}${y + 1};${x + 1}H`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  reset: `${CSI}0m`,
  inverse: `${CSI}7m`,
  white: `${CSI}97m`
};
var box3 = {
  tl: "┌",
  tr: "┐",
  bl: "└",
  br: "┘",
  h: "─",
  v: "│",
  ltee: "├",
  rtee: "┤",
  ttee: "┬",
  btee: "┴",
  cross: "┼",
  dtl: "╔",
  dtr: "╗",
  dbl: "╚",
  dbr: "╝",
  dh: "═",
  dv: "║"
};
var superscript = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
function drawLayoutPreview(template, x, y, w, h) {
  const lines = renderLayoutPreview(template, w, h);
  let out = "";
  lines.forEach((line, i) => {
    out += ansi.moveTo(x, y + i) + line;
  });
  return out;
}
var ANIMATION_FRAMES = 12;
var ANIMATION_FRAME_MS = 16;
function renderAnimationFrame(prevLayout, nextLayout, direction, frame, previewX, previewY, previewW, previewH) {
  const prevLines = renderLayoutPreview(prevLayout, previewW, previewH);
  const nextLines = renderLayoutPreview(nextLayout, previewW, previewH);
  const progress = frame / ANIMATION_FRAMES;
  const eased = 1 - Math.pow(1 - progress, 2);
  const offset = Math.round(previewW * eased);
  let out = "";
  for (let row = 0;row < previewH; row++) {
    const prevLine = prevLines[row] || "";
    const nextLine = nextLines[row] || "";
    let visibleChars = "";
    if (direction === "right") {
      for (let col = 0;col < previewW; col++) {
        const sourceCol = col + offset;
        if (sourceCol < previewW) {
          visibleChars += prevLine[sourceCol] || " ";
        } else {
          const nextCol = sourceCol - previewW;
          visibleChars += nextLine[nextCol] || " ";
        }
      }
    } else {
      for (let col = 0;col < previewW; col++) {
        const sourceCol = col - offset;
        if (sourceCol >= 0) {
          visibleChars += prevLine[sourceCol] || " ";
        } else {
          const nextCol = previewW + sourceCol;
          visibleChars += nextLine[nextCol] || " ";
        }
      }
    }
    out += ansi.moveTo(previewX, previewY + row) + visibleChars;
  }
  return out;
}
function startAnimation(direction) {
  state.animating = true;
  state.animationDirection = direction;
  state.animationFrame = 0;
  const prevLayout = ALL_LAYOUTS[state.previousLayoutIndex];
  const nextLayout = ALL_LAYOUTS[state.layoutIndex];
  const width = process.stdout.columns || 80;
  const height = process.stdout.rows || 24;
  const previewW = Math.min(width - 4, 40);
  const previewH = Math.min(height - 11, 12);
  const previewX = Math.floor((width - previewW) / 2);
  const previewY = 8;
  const paneCount = nextLayout.panes.length;
  const layoutFocused = state.focus === "layout";
  const counter = `${paneCount} pane${paneCount > 1 ? "s" : ""} · ${state.layoutIndex + 1}/${ALL_LAYOUTS.length}`;
  let counterOut = ansi.moveTo(Math.floor((width - counter.length - 2) / 2), previewY + previewH);
  if (layoutFocused)
    counterOut += ansi.inverse;
  counterOut += ` ${counter} `;
  counterOut += ansi.reset;
  process.stdout.write(counterOut);
  const tick = () => {
    state.animationFrame++;
    if (state.animationFrame >= ANIMATION_FRAMES) {
      state.animating = false;
      state.animationDirection = null;
      render();
      return;
    }
    const out = renderAnimationFrame(prevLayout, nextLayout, direction, state.animationFrame, previewX, previewY, previewW, previewH);
    process.stdout.write(out);
    setTimeout(tick, ANIMATION_FRAME_MS);
  };
  setTimeout(tick, ANIMATION_FRAME_MS);
}
function render() {
  const width = process.stdout.columns || 80;
  const height = process.stdout.rows || 24;
  let out = ansi.clear;
  const windowFocused = state.focus === "window";
  const maxIndex = state.windows.length + 1;
  const WINDOW_BOX_WIDTH = 17;
  const BUTTON_BOX_WIDTH = 3;
  let row0Parts = [];
  let row1Parts = [];
  let row2Parts = [];
  let row3Parts = [];
  const buildBox = (lines, innerWidth, isSelected, isDim = false, windowNumber) => {
    const tl = isSelected ? box3.dtl : box3.tl;
    const tr = isSelected ? box3.dtr : box3.tr;
    const bl = isSelected ? box3.dbl : box3.bl;
    const br = isSelected ? box3.dbr : box3.br;
    const h = isSelected ? box3.dh : box3.h;
    const v = isSelected ? box3.dv : box3.v;
    let topBorder;
    if (windowNumber !== undefined && windowNumber >= 0 && windowNumber <= 9) {
      topBorder = tl + h.repeat(innerWidth - 1) + superscript[windowNumber] + tr;
    } else {
      topBorder = tl + h.repeat(innerWidth) + tr;
    }
    const bottomBorder = bl + h.repeat(innerWidth) + br;
    const centerContent = (content) => {
      if (content.length < innerWidth) {
        const totalPadding = innerWidth - content.length;
        const leftPad = Math.floor(totalPadding / 2);
        const rightPad = totalPadding - leftPad;
        return " ".repeat(leftPad) + content + " ".repeat(rightPad);
      }
      return content.slice(0, innerWidth);
    };
    const middleRow1 = v + centerContent(lines[0]) + v;
    const middleRow2 = v + centerContent(lines[1]) + v;
    if (isSelected) {
      return [
        ansi.white + topBorder + ansi.reset,
        ansi.white + middleRow1 + ansi.reset,
        ansi.white + middleRow2 + ansi.reset,
        ansi.white + bottomBorder + ansi.reset
      ];
    } else if (isDim) {
      return [
        ansi.dim + topBorder + ansi.reset,
        ansi.dim + middleRow1 + ansi.reset,
        ansi.dim + middleRow2 + ansi.reset,
        ansi.dim + bottomBorder + ansi.reset
      ];
    }
    return [topBorder, middleRow1, middleRow2, bottomBorder];
  };
  if (state.confirmingDelete) {
    const confirmWidth = 10;
    const [t, m1, m2, b] = buildBox(["Delete?", "⏎"], confirmWidth, true);
    row0Parts.push(t);
    row1Parts.push(m1);
    row2Parts.push(m2);
    row3Parts.push(b);
  } else {
    const isMinusSelected = windowFocused && state.carouselIndex === 0;
    const [minusT, minusM1, minusM2, minusB] = buildBox([" − ", ""], BUTTON_BOX_WIDTH, isMinusSelected);
    row0Parts.push(minusT);
    row1Parts.push(minusM1);
    row2Parts.push(minusM2);
    row3Parts.push(minusB);
  }
  for (let i = 0;i < state.windows.length; i++) {
    const win = state.windows[i];
    const isSelected = windowFocused && state.carouselIndex === i + 1;
    const isCurrent = i === state.currentWindowIndex;
    const [line1, line2] = splitWindowName(win.name);
    let displayLine1 = line1;
    let displayLine2 = line2;
    if (isCurrent) {
      if (line2) {
        displayLine2 += " ●";
      } else {
        displayLine1 += " ●";
      }
    }
    const windowNum = i < 9 ? i + 1 : undefined;
    const [t, m1, m2, b] = buildBox([displayLine1, displayLine2], WINDOW_BOX_WIDTH, isSelected, false, windowNum);
    row0Parts.push(t);
    row1Parts.push(m1);
    row2Parts.push(m2);
    row3Parts.push(b);
  }
  const isPlusSelected = windowFocused && state.carouselIndex === maxIndex;
  const [plusT, plusM1, plusM2, plusB] = buildBox([" + ", ""], BUTTON_BOX_WIDTH, isPlusSelected, !isPlusSelected);
  row0Parts.push(plusT);
  row1Parts.push(plusM1);
  row2Parts.push(plusM2);
  row3Parts.push(plusB);
  const carouselRow0 = row0Parts.join(" ");
  const carouselRow1 = row1Parts.join(" ");
  const carouselRow2 = row2Parts.join(" ");
  const carouselRow3 = row3Parts.join(" ");
  const carouselBoxWidth = width - 4;
  const carouselStartX = 1;
  out += ansi.moveTo(carouselStartX, 0);
  out += ansi.dim + box3.tl + box3.h.repeat(carouselBoxWidth) + box3.tr + ansi.reset;
  out += ansi.moveTo(carouselStartX, 1);
  out += ansi.dim + box3.v + ansi.reset + " " + carouselRow0;
  out += ansi.moveTo(carouselStartX + carouselBoxWidth + 1, 1);
  out += ansi.dim + box3.v + ansi.reset;
  out += ansi.moveTo(carouselStartX, 2);
  out += ansi.dim + box3.v + ansi.reset + " " + carouselRow1;
  out += ansi.moveTo(carouselStartX + carouselBoxWidth + 1, 2);
  out += ansi.dim + box3.v + ansi.reset;
  out += ansi.moveTo(carouselStartX, 3);
  out += ansi.dim + box3.v + ansi.reset + " " + carouselRow2;
  out += ansi.moveTo(carouselStartX + carouselBoxWidth + 1, 3);
  out += ansi.dim + box3.v + ansi.reset;
  out += ansi.moveTo(carouselStartX, 4);
  out += ansi.dim + box3.v + ansi.reset + " " + carouselRow3;
  out += ansi.moveTo(carouselStartX + carouselBoxWidth + 1, 4);
  out += ansi.dim + box3.v + ansi.reset;
  out += ansi.moveTo(carouselStartX, 5);
  out += ansi.dim + box3.bl + box3.h.repeat(carouselBoxWidth) + box3.br + ansi.reset;
  out += ansi.moveTo(0, 6) + box3.h.repeat(width);
  const layout = ALL_LAYOUTS[state.layoutIndex];
  const previewW = Math.min(width - 4, 40);
  const previewH = Math.min(height - 11, 12);
  const previewX = Math.floor((width - previewW) / 2);
  const previewY = 8;
  out += drawLayoutPreview(layout, previewX, previewY, previewW, previewH);
  const paneCount = layout.panes.length;
  const layoutFocused = state.focus === "layout";
  const counter = `${paneCount} pane${paneCount > 1 ? "s" : ""} · ${state.layoutIndex + 1}/${ALL_LAYOUTS.length}`;
  out += ansi.moveTo(Math.floor((width - counter.length - 2) / 2), previewY + previewH);
  if (layoutFocused)
    out += ansi.inverse;
  out += ` ${counter} `;
  out += ansi.reset;
  out += ansi.moveTo(0, height - 2) + box3.h.repeat(width);
  const hints = state.mode === "dirPicker" ? "type to filter  jk nav  ⏎ select  esc cancel" : "tab focus  hjkl nav  ⏎ apply";
  out += ansi.moveTo(1, height - 1) + ansi.dim + hints + ansi.reset;
  if (state.mode === "dirPicker" && state.dirPicker) {
    out += renderDirPicker(state.dirPicker, width, height);
  }
  process.stdout.write(out);
}
async function renameWindowsOnStartup() {
  try {
    const windows = getWindows();
    if (windows.length === 0)
      return;
    log(`[cmux] Startup rename for ${windows.length} window(s)`);
    const contexts = await Promise.all(windows.map((w) => getWindowContext(w.index)));
    const summaries = getSummariesForWindows(contexts);
    for (const [windowIndex, summary] of summaries) {
      const shortName = sanitizeWindowName(summary);
      if (shortName.length > 0) {
        try {
          execSync2(`tmux rename-window -t :${windowIndex} "${shortName}"`);
          log(`[cmux] Renamed window ${windowIndex} to "${shortName}"`);
        } catch (e) {
          log(`[cmux] Rename failed for window ${windowIndex}:`, e);
        }
      }
    }
    state.windows = getWindows();
    render();
  } catch (e) {
    log("[cmux] Startup rename failed:", e);
  }
}
function handleKey(key) {
  if (state.mode === "dirPicker") {
    return handleDirPickerMode(key);
  }
  return handleMainKey(key);
}
function handleDirPickerMode(key) {
  if (!state.dirPicker) {
    state.mode = "main";
    return true;
  }
  const result = handleDirPickerKey(state.dirPicker, key);
  switch (result.action) {
    case "continue":
      state.dirPicker = result.state;
      break;
    case "cancel":
      state.mode = "main";
      state.dirPicker = null;
      break;
    case "select":
      createNewWindowAtPath(result.path);
      return false;
  }
  return true;
}
function handleMainKey(key) {
  let normalizedKey = key;
  if (key === "\x1B[A")
    normalizedKey = "k";
  else if (key === "\x1B[B")
    normalizedKey = "j";
  else if (key === "\x1B[C")
    normalizedKey = "l";
  else if (key === "\x1B[D")
    normalizedKey = "h";
  if (state.animating && (normalizedKey === "h" || normalizedKey === "j" || normalizedKey === "k" || normalizedKey === "l")) {
    if (state.focus === "layout") {
      return true;
    }
  }
  const maxCarouselIndex = state.windows.length + 1;
  switch (normalizedKey) {
    case "\t":
      state.focus = state.focus === "window" ? "layout" : "window";
      state.confirmingDelete = false;
      break;
    case "j":
      if (state.focus === "window") {
        state.focus = "layout";
        state.confirmingDelete = false;
      }
      break;
    case "k":
      if (state.focus === "layout") {
        state.focus = "window";
      }
      break;
    case "h":
      if (state.focus === "window") {
        if (state.carouselIndex > 0) {
          state.carouselIndex--;
          state.confirmingDelete = false;
        }
      } else {
        state.previousLayoutIndex = state.layoutIndex;
        state.layoutIndex = (state.layoutIndex - 1 + ALL_LAYOUTS.length) % ALL_LAYOUTS.length;
        startAnimation("left");
        return true;
      }
      break;
    case "l":
      if (state.focus === "window") {
        if (state.carouselIndex < maxCarouselIndex) {
          state.carouselIndex++;
          state.confirmingDelete = false;
        }
      } else {
        state.previousLayoutIndex = state.layoutIndex;
        state.layoutIndex = (state.layoutIndex + 1) % ALL_LAYOUTS.length;
        startAnimation("right");
        return true;
      }
      break;
    case " ":
    case "\r":
      if (state.focus === "window") {
        if (state.carouselIndex === 0) {
          if (state.confirmingDelete) {
            removeCurrentWindow();
            return false;
          } else {
            if (state.windows.length > 1) {
              state.confirmingDelete = true;
            }
          }
        } else if (state.carouselIndex === maxCarouselIndex) {
          openDirPicker();
        } else {
          const windowIndex2 = state.carouselIndex - 1;
          const selectedWindow = state.windows[windowIndex2];
          if (selectedWindow && windowIndex2 !== state.currentWindowIndex) {
            try {
              execSync2(`tmux select-window -t :${selectedWindow.index}`);
            } catch {}
            return false;
          }
        }
      } else {
        applyAndExit();
        return false;
      }
      break;
    case "\x1B":
      if (state.confirmingDelete) {
        state.confirmingDelete = false;
      } else {
        return false;
      }
      break;
    case "q":
      return false;
    case "-":
      if (state.confirmingDelete) {
        removeCurrentWindow();
        return false;
      } else {
        if (state.windows.length > 1) {
          state.carouselIndex = 0;
          state.focus = "window";
          state.confirmingDelete = true;
        }
      }
      break;
    case "+":
    case "=":
      openDirPicker();
      break;
    case "1":
    case "2":
    case "3":
    case "4":
    case "5":
    case "6":
    case "7":
    case "8":
    case "9":
      const windowIndex = parseInt(normalizedKey) - 1;
      if (windowIndex < state.windows.length) {
        const selectedWindow = state.windows[windowIndex];
        try {
          execSync2(`tmux select-window -t :${selectedWindow.index}`);
        } catch {}
        return false;
      }
      break;
  }
  return true;
}
function openDirPicker() {
  try {
    const currentPath = execSync2("tmux display-message -p '#{pane_current_path}'").toString().trim();
    if (currentPath) {
      state.dirPicker = initDirPickerState(currentPath);
      state.mode = "dirPicker";
    } else {
      createNewWindow();
    }
  } catch {
    createNewWindow();
  }
}
function createNewWindowAtPath(targetPath) {
  try {
    const pathArg = `-c "${targetPath}"`;
    execSync2(`tmux new-window ${pathArg}`);
    const layout = ALL_LAYOUTS[state.layoutIndex];
    const paneCount = layout.panes.length;
    for (let i = 1;i < paneCount; i++) {
      execSync2(`tmux split-window ${pathArg}`);
    }
    const windowInfo = getWindowInfo();
    const resolved = resolveLayout(layout, windowInfo.width, windowInfo.height);
    const panes = resolved.map((r, i) => ({
      id: windowInfo.panes[i]?.id || `%${i}`,
      ...r
    }));
    const layoutString = generateLayoutString(panes, windowInfo.width, windowInfo.height);
    execSync2(`tmux select-layout '${layoutString}'`);
  } catch (e) {}
}
function createNewWindow() {
  try {
    const currentPath = execSync2("tmux display-message -p '#{pane_current_path}'").toString().trim();
    const pathArg = currentPath ? `-c "${currentPath}"` : "";
    execSync2(`tmux new-window ${pathArg}`);
    const layout = ALL_LAYOUTS[state.layoutIndex];
    const paneCount = layout.panes.length;
    for (let i = 1;i < paneCount; i++) {
      execSync2(`tmux split-window ${pathArg}`);
    }
    const windowInfo = getWindowInfo();
    const resolved = resolveLayout(layout, windowInfo.width, windowInfo.height);
    const panes = resolved.map((r, i) => ({
      id: windowInfo.panes[i]?.id || `%${i}`,
      ...r
    }));
    const layoutString = generateLayoutString(panes, windowInfo.width, windowInfo.height);
    execSync2(`tmux select-layout '${layoutString}'`);
  } catch (e) {}
}
function removeCurrentWindow() {
  if (state.windows.length <= 1)
    return;
  try {
    const windowToDelete = state.windows[state.currentWindowIndex];
    execSync2(`tmux kill-window -t :${windowToDelete.index}`);
  } catch (e) {}
}
function applyAndExit() {
  const layout = ALL_LAYOUTS[state.layoutIndex];
  const targetWindow = state.windows[state.currentWindowIndex];
  try {
    const currentPath = execSync2("tmux display-message -p '#{pane_current_path}'").toString().trim();
    const pathArg = currentPath ? `-c "${currentPath}"` : "";
    const windowInfo = getWindowInfo();
    const paneCount = layout.panes.length;
    const currentPaneCount = windowInfo.panes.length;
    if (!targetWindow.active) {
      execSync2(`tmux select-window -t :${targetWindow.index}`);
    }
    if (currentPaneCount < paneCount) {
      for (let i = currentPaneCount;i < paneCount; i++) {
        execSync2(`tmux split-window ${pathArg}`);
      }
    } else if (currentPaneCount > paneCount) {
      for (let i = currentPaneCount;i > paneCount; i--) {
        execSync2(`tmux kill-pane`);
      }
    }
    const updatedInfo = getWindowInfo();
    const resolved = resolveLayout(layout, updatedInfo.width, updatedInfo.height);
    const panes = resolved.map((r, i) => ({
      id: updatedInfo.panes[i]?.id || `%${i}`,
      ...r
    }));
    const layoutString = generateLayoutString(panes, updatedInfo.width, updatedInfo.height);
    execSync2(`tmux select-layout '${layoutString}'`);
  } catch (e) {}
}
function isInsideTmux() {
  return !!process.env.TMUX;
}
function startTmuxSession() {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.TEST_ANTHROPIC_API_KEY || process.env.DEMO_ANTHROPIC_API_KEY;
  const tmuxArgs = [
    "-f",
    CONFIG_PATH,
    "new-session",
    ";",
    "bind",
    "-n",
    "M-Space",
    "display-popup",
    "-w",
    "80%",
    "-h",
    "80%",
    "-E",
    `bun ${SELF_PATH}`
  ];
  if (apiKey) {
    tmuxArgs.push(";", "set-environment", "-gh", "ANTHROPIC_API_KEY", apiKey);
  }
  if (apiKey) {
    tmuxArgs.push(";", "run-shell", "-b", `ANTHROPIC_API_KEY='${apiKey}' bun ${BACKGROUND_RENAMER_PATH} >/dev/null 2>&1`);
  }
  const tmux = spawn("tmux", tmuxArgs, {
    stdio: "inherit"
  });
  tmux.on("close", (code) => {
    process.exit(code ?? 0);
  });
}
function runUI() {
  if (!process.stdin.isTTY) {
    console.error("Not a TTY");
    process.exit(1);
  }
  initLog();
  log("[cmux] runUI starting");
  process.stdout.write(ansi.altScreen + ansi.hideCursor);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  render();
  startPolling();
  renameWindowsOnStartup();
  process.stdin.on("data", (data) => {
    const input = data.toString();
    let i = 0;
    while (i < input.length) {
      let key;
      if (input[i] === "\x1B" && input[i + 1] === "[") {
        const arrowChar = input[i + 2];
        if (arrowChar === "A" || arrowChar === "B" || arrowChar === "C" || arrowChar === "D") {
          key = input.slice(i, i + 3);
          i += 3;
        } else {
          key = input[i];
          i++;
        }
      } else {
        key = input[i];
        i++;
      }
      if (!handleKey(key)) {
        cleanup();
        return;
      }
    }
    render();
  });
}
function main() {
  if (!isInsideTmux()) {
    startTmuxSession();
    return;
  }
  runUI();
}
function cleanup() {
  stopPolling();
  process.stdout.write(ansi.showCursor + ansi.exitAltScreen);
  process.stdin.setRawMode(false);
  process.exit(0);
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
main();
