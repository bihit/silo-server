package handlers

import (
	"reflect"
	"testing"
)

func TestMissingNumbers(t *testing.T) {
	cases := []struct {
		name     string
		from, to int
		have     []int32
		limit    int
		want     []int
	}{
		{"inner gaps", 1, 6, []int32{1, 2, 4, 6}, 10, []int{3, 5}},
		{"leading gap", 1, 4, []int32{3, 4}, 10, []int{1, 2}},
		{"complete", 1, 3, []int32{3, 1, 2}, 10, []int{}},
		{"absolute numbering", 301, 304, []int32{301, 302, 304}, 10, []int{303}},
		{"bounded", 1, 265, []int32{1, 265}, 3, []int{2, 3, 4}},
		{"empty range", 1, 0, nil, 10, []int{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := missingNumbers(tc.from, tc.to, tc.have, tc.limit); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("missingNumbers(%d, %d, %v) = %v, want %v", tc.from, tc.to, tc.have, got, tc.want)
			}
		})
	}
}

func TestSeriesGapView(t *testing.T) {
	t.Run("local gaps only", func(t *testing.T) {
		v, ok := seriesGapView(map[int][]int32{1: {1, 2, 4}, 3: {1}}, nil, false)
		if !ok || len(v.Seasons) != 1 || !reflect.DeepEqual(v.Seasons[0].Missing, []int{3}) {
			t.Fatalf("view = %+v", v)
		}
		if len(v.MissingSeasons) != 1 || v.MissingSeasons[0].SeasonNumber != 2 || v.MissingSeasons[0].ExpectedEpisodes != nil {
			t.Fatalf("missing seasons = %+v", v.MissingSeasons)
		}
	})
	t.Run("tmdb trailing episodes and seasons", func(t *testing.T) {
		exp := seriesTMDBExpectation{1: 5, 2: 3}
		v, ok := seriesGapView(map[int][]int32{1: {1, 2, 3}}, exp, true)
		if !ok || len(v.Seasons) != 1 || !reflect.DeepEqual(v.Seasons[0].Missing, []int{4, 5}) || *v.Seasons[0].ExpectedEpisodes != 5 {
			t.Fatalf("seasons = %+v", v.Seasons)
		}
		if len(v.MissingSeasons) != 1 || v.MissingSeasons[0].SeasonNumber != 2 || *v.MissingSeasons[0].ExpectedEpisodes != 3 {
			t.Fatalf("missing seasons = %+v", v.MissingSeasons)
		}
	})
	t.Run("complete against tmdb", func(t *testing.T) {
		if v, ok := seriesGapView(map[int][]int32{1: {1, 2}}, seriesTMDBExpectation{1: 2}, true); ok {
			t.Fatalf("complete series reported: %+v", v)
		}
	})
	t.Run("numbering mismatch suppresses tmdb seasons", func(t *testing.T) {
		v, ok := seriesGapView(map[int][]int32{1: {1, 2, 3, 4, 5, 6}}, seriesTMDBExpectation{1: 3, 2: 3}, true)
		if ok {
			t.Fatalf("mismatch alone reported gaps: %+v", v)
		}
	})
	t.Run("absolute numbering ignores tmdb totals", func(t *testing.T) {
		if v, ok := seriesGapView(map[int][]int32{3: {301, 302}}, seriesTMDBExpectation{3: 10}, true); ok && len(v.Seasons) > 0 {
			t.Fatalf("absolute season reported: %+v", v.Seasons)
		}
	})
}
