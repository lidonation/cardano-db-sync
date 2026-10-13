/** A raw colour: a hex literal or a colour function. Strings and `url()` are blanked first. */
export const RAW_COLOUR =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

/** The CSS named colours, less `transparent` and `currentColor`, which pick no palette colour. */
const NAMED_COLOURS = (
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
  'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
  'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
  'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
  'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
  'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
  'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
  'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
  'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
  'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
  'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
  'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
  'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
  'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
  'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
  'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
  'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
).split(' ');
export const NAMED_COLOUR = new RegExp(`(?<![\\w-])(?:${NAMED_COLOURS.join('|')})(?![\\w-])`, 'i');
