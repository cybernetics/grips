(function(global){

	/* Token */
	function Token(props) {
		for (var i in props) { if (props.hasOwnProperty(i)) {
			this[i] = props[i];
		}}
	};
	Token.prototype.toString = function() {
		// simple, non-escaped, JSON'ish (but not really) string serialization of Token
		var ret = "";
		for (var i in this) { if (this.hasOwnProperty(i)) {
			ret += (ret != "" ? ", " : "") + i + ": ";
			if (typeof this[i] === "string") ret += "\"" + this[i] + "\"";
			else ret += this[i];
		}}

		return "{ " + ret + " }";
	};

	/* TokenizerError */
	var TokenizerError = (function() {
		function F(){}
		function CustomError(msg,token) {
			// correct if not called with "new"
			var self = (this===window) ? new F() : this;
			self.message = msg;
			self.token = token;
			return self;
		}
		F.prototype = CustomError.prototype = Object.create(Error.prototype);
		CustomError.prototype.constructor = CustomError;

		CustomError.prototype.toString = function() {
			return "Tokenizer Error: " + this.message + " at position " + this.token.pos + "\n" + this.token.toString();
		};
		return CustomError;
	})();

	/* Tokenizer */
	function process(chunk) {

		function combineGeneralTokens(tokensSlice) {
			var start, end;

			for (var i=0; i<tokensSlice.length; i++) {
				if (tokensSlice[i].type === TOKEN_TAG_GENERAL) {
					start = end = i;
					for (j=start+1; j<tokensSlice.length; j++) {
						if (tokensSlice[j].type !== TOKEN_TAG_GENERAL) {
							end = j-1;
							break;
						}
					}
					if (end > start) {
						for (j=start+1; j<=end; j++) {
							tokensSlice[start].val += tokensSlice[j].val;
						}
						tokensSlice.splice(start+1,end-start);
					}
					else i = j;
				}
			}

			return tokensSlice;
		}

		function unescapeGeneralTokens(tokensSlice) {
			for (var i=0; i<tokensSlice.length; i++) {
				if (tokensSlice[i].type === TOKEN_TAG_GENERAL) {
					tokensSlice[i].val = tokensSlice[i].val.replace(/\\\\/g,"\\");
				}
			}

			return tokensSlice;
		}

		function handleOutsideMatch() {
			var tokensSlice, leftContext;

			// capture preceeding unmatched string, if any
			if (unmatched) {
				token = new Token({
					val: unmatched,
					pos: prev_match_idx
				});
				if (unmatched.match(/^\s+$/)) {
					token.type = TOKEN_TAG_WHITESPACE;
				}
				else {
					token.type = TOKEN_TAG_GENERAL;
				}
				tokens.push(token);
			}
			if (match) {
				leftContext = chunk.substring(0,next_match_idx - match[0].length);

				// is the match at the beginning or is it NOT escaped?
				if (!leftContext || leftContext.match(not_escaped_pattern)) {
					// block footer tag?
					if (match[0] === "{$}") {
						tokens.push(new Token({
							type: TOKEN_TAG_BLOCK_FOOTER,
							val: match[0],
							pos: next_match_idx - match[0].length
						}));
					}
					// start of tag?
					else if (match[0] === "{$") {
						token = new Token({
							type: TOKEN_TAG_OPEN,
							val: match[0],
							pos: next_match_idx - match[0].length
						});
						tokens.push(token);
						// look ahead to the tag-type signifier, if any
						if ((next_match_idx < chunk.length - 1) && 
							(match = chunk.substr(next_match_idx,1).match(/[:+=*\/%]/))
						) {
							tokens.push(new Token({
								type: TOKEN_TAG_SIGNIFIER,
								val: match[0],
								pos: next_match_idx
							}));
							next_match_idx++;
						}
						else {
							return new global.grips.parser.ParserError("Expected Tag type-signifier",new Token({
								type: TOKEN_TAG_GENERAL,
								val: chunk.substr(next_match_idx,1),
								pos: next_match_idx
							}));
						}
					}
					// unexpected/unrecognized token, bail
					else {
						return new TokenizerError("Unrecognized token",new Token({
							type: TOKEN_TAG_UNKNOWN,
							val: match[0],
							pos: next_match_idx - match[0].length
						}));
					}
				}
				// otherwise, since it was escaped, treat the match as just a general token
				else {
					tokens.push(new Token({
						type: TOKEN_TAG_GENERAL,
						val: match[0],
						pos: next_match_idx - match[0].length
					}));
					// general tokens can't change the state of the parser, so skip the parse step for now
					return;
				}
			}
			
			// run the parser step, only on the unprocessed tokens
			tokens = tokens.concat((tokensSlice = unescapeGeneralTokens(combineGeneralTokens(tokens.splice(token_idx-tokens.length)))));
			parser_res = global.grips.parser.nodify(tokensSlice);
			token_idx = tokens.length;
		}

		function handleInsideMatch() {
			var tokensSlice, tmp;

			// capture preceeding unmatched string, if any
			if (unmatched) {
				// check to see if there are any invalid token characters
				tmp = /[^a-z0-9_$\s]/i.exec(unmatched);
				if (tmp) {
					return new TokenizerError("Unrecognized token",new Token({
						type: TOKEN_TAG_GENERAL,
						val: tmp[0],
						pos: prev_match_idx + tmp.index
					}));
				}
				else {
					tokens.push(new Token({
						type: TOKEN_TAG_GENERAL,
						val: unmatched,
						pos: prev_match_idx
					}));
				}
			}
			if (match) {
				if (match[0] === "$}") {
					tokens.push(new Token({
						type: TOKEN_TAG_SIMPLE_CLOSE,
						val: match[0],
						pos: next_match_idx - match[0].length
					}));
				}
				else if (match[0] === "}") {
					tokens.push(new Token({
						type: TOKEN_TAG_BLOCK_HEAD_CLOSE,
						val: match[0],
						pos: next_match_idx - match[0].length
					}));
				}
				else if (match[0].match(/^\s+$/)) {
					tokens.push(new Token({
						type: TOKEN_TAG_WHITESPACE,
						val: match[0],
						pos: next_match_idx - match[0].length
					}));
					// whitespace can't change the state of the parser, so skip the parse step for now
					return;
				}
				else if (match[0].match(/^["']$/)) {
					token = new Token({
						type: 0,
						val: match[0],
						pos: next_match_idx - match[0].length
					});
					if (match[0] === "\"") token.type = TOKEN_TAG_DOUBLE_QUOTE;
					else token.type = TOKEN_TAG_SINGLE_QUOTE;

					tokens.push(token);

					parser_state_patterns[global.grips.parser.LITERAL] = new RegExp(match[0],"g");
					parser_state_patterns[global.grips.parser.LITERAL].lastIndex = 0; // reset to prevent browser "regex caching" bug
				}
				else if (match[0].match(/^(?:\|\|)|(?:\&\&)|(?:\=\=)|[:=?\(\)\[\],\-.]$/)) {
					tokens.push(new Token({
						type: TOKEN_TAG_OPERATOR,
						val: match[0],
						pos: next_match_idx - match[0].length
					}));
				}
				else if (match[0] === "|") {
					tokens.push(new Token({
						type: TOKEN_TAG_PIPE,
						val: match[0],
						pos: next_match_idx - match[0].length
					}));
				}
				else if (match[0] === "@") {
					tokens.push(new Token({
						type: TOKEN_TAG_AT,
						val: match[0],
						pos: next_match_idx - match[0].length
					}));
				}
				else {
					tokens.push(new Token({
						type: TOKEN_TAG_GENERAL,
						val: match[0],
						pos: next_match_idx - match[0].length
					}));
					// general tokens can't change the state of the parser, so skip the parse step for now
					return;
				}
			}

			// run the parser step, only on the unprocessed tokens
			tokens = tokens.concat((tokensSlice = unescapeGeneralTokens(combineGeneralTokens(tokens.splice(token_idx-tokens.length)))));
			parser_res = global.grips.parser.nodify(tokensSlice);
			token_idx = tokens.length;
		}

		function handleRawMatch(){
			var tokensSlice, leftContext;

			// make sure we have a general content token for the current raw tag
			if (tokens[tokens.length-1].type != TOKEN_TAG_GENERAL) {
				tokens.push(new Token({
					type: TOKEN_TAG_GENERAL,
					val: "",
					pos: prev_match_idx
				}));
			}

			// capture preceeding unmatched string, if any
			if (unmatched) {
				tokens[tokens.length-1].val += unmatched;
			}
			if (match) {
				leftContext = tokens[tokens.length-1].val;

				// is the match at the beginning or is it NOT escaped?
				if (!leftContext || leftContext.match(not_escaped_pattern)) {
					tokens.push(new Token({
						type: TOKEN_TAG_RAW_CLOSE,
						val: match[0],
						pos: next_match_idx - match[0].length
					}));

					// run the parser step, only on the unprocessed tokens
					tokens = tokens.concat((tokensSlice = unescapeGeneralTokens(combineGeneralTokens(tokens.splice(token_idx-tokens.length)))));
					parser_res = global.grips.parser.nodify(tokensSlice);
					token_idx = tokens.length;
				}
				// otherwise just add the match to the literal's general content token
				else {
					// was it escaped?
					if (leftContext && !leftContext.match(not_escaped_pattern)) {
						tokens[tokens.length-1].val = tokens[tokens.length-1].val.substr(0,tokens[tokens.length-1].val.length-1);
					}
					tokens[tokens.length-1].val += match[0];
				}
			}
		}

		function handleCommentMatch(){
			var tokensSlice, leftContext;

			if (match) {
				leftContext = tokens[tokens.length-1].val;

				// is the match at the beginning or is it NOT escaped?
				if (!leftContext || leftContext.match(not_escaped_pattern)) {
					tokens.push(new Token({
						type: TOKEN_TAG_COMMENT_CLOSE,
						val: match[0],
						pos: next_match_idx - match[0].length
					}));

					// run the parser step, only on the unprocessed tokens
					tokens = tokens.concat((tokensSlice = unescapeGeneralTokens(combineGeneralTokens(tokens.splice(token_idx-tokens.length)))));
					parser_res = global.grips.parser.nodify(tokensSlice);
					token_idx = tokens.length;
				}
			}
		}

		function handleLiteralMatch(){
			var tokensSlice, leftContext;

			// make sure we have a general content token for the current literal
			if (tokens[tokens.length-1].type != TOKEN_TAG_GENERAL) {
				tokens.push(new Token({
					type: TOKEN_TAG_GENERAL,
					val: "",
					pos: prev_match_idx
				}));
			}

			// capture preceeding unmatched string, if any
			if (unmatched) {
				tokens[tokens.length-1].val += unmatched;
			}
			if (match) {
				leftContext = tokens[tokens.length-1].val;

				// is the match at the beginning or is it NOT escaped?
				if (!leftContext || leftContext.match(not_escaped_pattern)) {
					tokens.push(new Token({
						type: (match[0] === "\"" ? TOKEN_TAG_DOUBLE_QUOTE : TOKEN_TAG_SINGLE_QUOTE),
						val: match[0],
						pos: next_match_idx - match[0].length
					}));

					// run the parser step, only on the unprocessed tokens
					tokens = tokens.concat((tokensSlice = unescapeGeneralTokens(combineGeneralTokens(tokens.splice(token_idx-tokens.length)))));
					parser_res = global.grips.parser.nodify(tokensSlice);
					token_idx = tokens.length;

					// unset the pattern used to match the end of the literal
					parser_state_patterns[global.grips.parser.LITERAL] = null;
				}
				// otherwise just add the match to the literal's general content token
				else {
					// was it escaped?
					if (leftContext && !leftContext.match(not_escaped_pattern)) {
						tokens[tokens.length-1].val = tokens[tokens.length-1].val.substr(0,tokens[tokens.length-1].val.length-1);
					}
					tokens[tokens.length-1].val += match[0];
				}
			}
		}


		var regex, next_match_idx = 0, prev_match_idx = 0, token_idx = tokens.length,
			match, parser_state, unmatched, parser_res, token, res,
			match_handlers = [
				handleOutsideMatch,
				handleInsideMatch,
				handleRawMatch,
				handleCommentMatch,
				handleLiteralMatch
			]
		;

		while ((!parser_res || parser_res === true) && next_match_idx < chunk.length) {
			parser_res = null;
			parser_state = global.grips.parser.state;
			if (parser_state === global.grips.parser.INVALID) break;

			regex = parser_state_patterns[parser_state];

			if (regex) {
				unmatched = "";
				regex.lastIndex = next_match_idx;
				match = regex.exec(chunk);

				if (match) {
					prev_match_idx = next_match_idx;
					next_match_idx = regex.lastIndex;

					// collect the previous string chunk not matched before this token
					if (prev_match_idx < next_match_idx - match[0].length) {
						unmatched = chunk.substring(prev_match_idx,next_match_idx - match[0].length);
					}
				}
				else {
					prev_match_idx = next_match_idx;
					next_match_idx = chunk.length;
					unmatched = chunk.substr(prev_match_idx);
					if (!unmatched) break;
				}

				// invoke the match handler for current parser state
				res = match_handlers[parser_state]();
				if (res && res !== true) break;
				if (parser_res && parser_res !== true) break;
			}
			else {
				parser_res = new global.grips.parser.ParserError("Invalid parser state");
				break;
			}
		}

		if (res instanceof TokenizerError ||
			res instanceof global.grips.parser.ParserError
		) {
			throw res;
		}
		if (parser_res instanceof TokenizerError ||
			parser_res instanceof global.grips.parser.ParserError
		) {
			throw parser_res;
		}

		return true;
	}


	var tokens = [],

		current_token = 0,

		TOKEN_TAG_OPEN = 0,
		TOKEN_TAG_SIMPLE_CLOSE = 1,
		TOKEN_TAG_BLOCK_HEAD_CLOSE = 2,
		TOKEN_TAG_BLOCK_FOOTER = 3,
		TOKEN_TAG_SIGNIFIER = 4,
		TOKEN_TAG_COMMENT_CLOSE = 5,
		TOKEN_TAG_RAW_CLOSE = 6,
		TOKEN_TAG_PIPE = 7,
		TOKEN_TAG_AT = 8,
		TOKEN_TAG_LITERAL = 9,
		TOKEN_TAG_SINGLE_QUOTE = 10,
		TOKEN_TAG_DOUBLE_QUOTE = 11,
		TOKEN_TAG_OPERATOR = 12,
		TOKEN_TAG_GENERAL = 13,
		TOKEN_TAG_WHITESPACE = 14,

		not_escaped_pattern = /(?:[^\\]|(?:^|[^\\])(?:\\\\)+)$/,
		parser_state_patterns = [
			/\{\$\}|\{\$/g, /*outside*/
			/\$\}|\}|(?:\|\|)|(?:\&\&)|(?:\=\=)|["':=@\|?\(\)\[\],\-.]|\s+/g, /*inside*/
			/%\$\}/g, /*raw*/
			/\/\$\}/g /*comment*/
		],

		instance_api
	;

	instance_api = {
		OPEN: TOKEN_TAG_OPEN,
		SIMPLE_CLOSE: TOKEN_TAG_SIMPLE_CLOSE,
		BLOCK_HEAD_CLOSE: TOKEN_TAG_BLOCK_HEAD_CLOSE,
		BLOCK_FOOTER: TOKEN_TAG_BLOCK_FOOTER,
		SIGNIFIER: TOKEN_TAG_SIGNIFIER,
		COMMENT_CLOSE: TOKEN_TAG_COMMENT_CLOSE,
		RAW_CLOSE: TOKEN_TAG_RAW_CLOSE,
		PIPE: TOKEN_TAG_PIPE,
		AT: TOKEN_TAG_AT,
		LITERAL: TOKEN_TAG_LITERAL,
		SINGLE_QUOTE: TOKEN_TAG_SINGLE_QUOTE,
		DOUBLE_QUOTE: TOKEN_TAG_DOUBLE_QUOTE,
		OPERATOR: TOKEN_TAG_OPERATOR,
		GENERAL: TOKEN_TAG_GENERAL,
		WHITESPACE: TOKEN_TAG_WHITESPACE,

		process: process,
		dump: function(){ return tokens; },

		Token: Token,
		TokenizerError: TokenizerError
	};

	global.grips.tokenizer = instance_api;

})(this);