\ web-forth prelude (SPEC §T.10). Higher-level words bootstrapped in Forth itself,
\ interpreted at boot after the TypeScript primitives are installed (§V.16).
\ Words already provided as primitives (negate 1+ 1- space variable constant ...)
\ are not redefined here. DOES>-based defining words are Extended.

\ --- Stack utilities ---
: ?dup dup if dup then ;
: nip swap drop ;
: tuck swap over ;
: 2dup over over ;
: 2drop drop drop ;
\ -rot ( a b c -- c a b ) : inverse of rot. Two rots rotate the other way.
: -rot rot rot ;

\ --- Comparison / flags ---
: 0<> 0= 0= ;
: true -1 ;
: false 0 ;

\ --- Arithmetic ---
: abs dup 0< if negate then ;
: min 2dup > if swap then drop ;
: max 2dup < if swap then drop ;

\ --- Output ---
\ spaces ( n -- ) : emit n spaces. Guard the zero/negative case because DO is
\ post-test (runs once at limit==index); ?DO is Extended.
: spaces dup 0> if 0 do space loop else drop then ;
