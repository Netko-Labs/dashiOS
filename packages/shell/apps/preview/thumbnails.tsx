/** The PDF's page strip: a thumbnail per page, the open page marked, a click goes there. */

import { Image, ScrollView, Text, View } from "@mirinjs/metal";
import { useColors } from "@dashi/ui";
import type { PdfState } from "./viewer.ts";

const THUMB_WIDTH = 150;

export function Thumbnails({ pdf, pageSize, onPage }: { pdf: PdfState; pageSize: { width: number; height: number } | null; onPage: (page: number) => void }) {
  const colors = useColors();
  const ratio = pageSize ? pageSize.height / pageSize.width : 1.3;
  const height = Math.round(THUMB_WIDTH * Math.min(Math.max(ratio, 0.4), 2.5));
  const pages = Array.from({ length: pdf.pages }, (_, index) => index + 1);
  return (
    <ScrollView testID="thumbnails" style={{ flex: 1, flexDirection: "column", gap: 10, paddingTop: 4, paddingBottom: 12 }}>
      {pages.map((page) => {
        const current = page === pdf.page;
        const source = pdf.thumbs.get(page);
        return (
          <View key={page} testID={`thumb:${page}`} onPress={() => onPage(page)} style={{ flexShrink: 0, alignItems: "center", gap: 4 }}>
            <View
              style={{
                width: THUMB_WIDTH + 8,
                height: height + 8,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                borderWidth: 2,
                borderColor: current ? colors.selection : "#00000000",
                hoverBackgroundColor: current ? "#00000000" : colors.button,
              }}
            >
              {source !== undefined ? (
                <Image source={source} resizeMode="contain" style={{ width: THUMB_WIDTH, height, borderRadius: 2 }} />
              ) : (
                <View style={{ width: THUMB_WIDTH, height, backgroundColor: "#ffffff", opacity: 0.6, borderRadius: 2 }} />
              )}
            </View>
            <Text style={{ fontSize: 11, fontWeight: current ? "semibold" : "normal", color: current ? colors.selection : colors.textMuted }}>{String(page)}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}
